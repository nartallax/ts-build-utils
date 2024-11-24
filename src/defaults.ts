import * as Path from "path"
import * as Fs from "fs"
import * as Esbuild from "esbuild"
import * as Chokidar from "chokidar"

import {generateDts, GenerateDtsOptions} from "build_utils/dts"
import {npx} from "build_utils/npx"
import {runJs, RunJsOptions, startJsProcess, StartJsProcessOptions} from "build_utils/run_js"
import {generateTestEntrypoint, runTests, TestEntrypointGenerationOptions, TestRunOptions} from "build_utils/testing"
import {typecheck, TypecheckOptions} from "build_utils/typecheck"
import {runShell} from "shell"
import {BuildOptionsWithHandlers, buildWatch, omitBuildHandlers} from "build_utils/esbuild"
import {npmInstall, NpmInstallOptions, npmPublish, NpmPublishOptions} from "build_utils/npm"
import {getFileSizeStr, omit, oneAtATime} from "utils"
import {cutPackageJson} from "@nartallax/package-cutter"
import {StatsCollector} from "build_utils/stats"
import {generateIconFont} from "@nartallax/icon-font-tool"
import {getConfigUtils} from "config_utils"
import {git} from "build_utils/git"
import {isDirectoryExists, isFileExists, isSymlinkExists, symlink, SymlinkOptions} from "build_utils/fs_utils"
import {generateServiceSystemdConfig, GenerateServiceSystemdConfigOptions, generateSystemdExecCommand, GenerateSystemdExecCommandOptions, installSystemdService, InstallSystemdConfigOptions, SystemdServiceActionOptions, systemdRestart, systemdStart, systemdStop, systemdStatus, systemdCommand} from "build_utils/systemd"

export type IconParams = Parameters<typeof generateIconFont>[0]
type CustomBuildOptions = BuildOptionsWithHandlers & {iconFont?: IconParams}
export const omitCustomBuildOptions = (opts: CustomBuildOptions) => omitBuildHandlers(omit(opts, "iconFont"))

export type BuildUtilsDefaults = {
	/** Root directory with all the source files.
	Defaults to compilerOptions.rootDir from tsconfig.json. */
	sources?: string
	/** Path to directory where generated TypeScript files should be placed.
	Defaults to "./generated" in sources root */
	generatedSources?: string
	/** Path (presumably in generated sources directory) to a TS file that will contain all the tests.
	Defaults to "test.ts" inside generated sources directory. */
	testEntrypoint?: string
	/** Target directory where all the artifacts of the build will be generated.
	Defaults to "./target" */
	target?: string
	/** Path to tsconfig.json.
	Defaults to "./tsconfig.json" */
	tsconfig?: string
	/** Path to package.json.
	Defaults to "./package.json" */
	packageJson?: string
	/** Path to JS file that will contain all the tests that should be run.
	Defaults to "test.js" in target directory */
	testJs?: string
	/** Path to .d.ts file with type definitions, generated from entrypoint.
	Defaults to content of "types" field from package.json, resolved from target directory. */
	dtsPath?: string
	/** Default build options. Will be added to all build actions defaulted build utils perform. */
	defaultBuildOptions?: Partial<BuildOptionsWithHandlers>
	/** Options that describe icon font.
	Icon font is automatically built on build(), and watched on watch()/serve() */
	icons?: IconParams
}

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** Creates a version of all build utils that have defaults for most mandatory parameters.
Also adds some more utility functions that makes no sense to have separately of defaults. */
export const buildUtils = (options: BuildUtilsDefaults) => {
	const config = getConfigUtils(options)
	const stats = new StatsCollector()

	const tryWatchIconFont = async(overrides?: IconParams): Promise<() => void> => {
		const args = config.getEffectiveIconArgs(overrides)
		if(args){
			return await watchIcons(args)
		}
		return () => {}
	}

	const tryBuildIconFont = async(overrides?: IconParams) => {
		const args = config.getEffectiveIconArgs(overrides)
		if(args){
			await generateIconFont(args)
		}
	}

	const watchIcons = async(args: IconParams): Promise<() => void> => {
		await generateIconFont(args)
		const watcher = Chokidar.watch([args.svgDir], {awaitWriteFinish: true}).on("all", async() => {
			try {
				await generateIconFont(args)
			} catch(e){
				console.error("Error rebuilding icons: ", e)
			}
		})
		return () => watcher.close()
	}

	const prependToHandler = (handler: (() => void) | undefined, preActions: () => void | Promise<void>): () => void => {
		if(!handler){
			return preActions
		}
		return async() => {
			await Promise.resolve(preActions)
			return handler()
		}
	}

	const wrapSystemdAction = (cmd: (opts: SystemdServiceActionOptions) => Promise<void>) =>
		(opts: Optional<SystemdServiceActionOptions, "serviceName"> = {}) => cmd({
			serviceName: config.getPackageNameWithoutNamespace(),
			...opts
		})

	const buildUtils = {
		/** Run an npm-installed executable using command-line and npx */
		npx,

		/** Various git-related functions */
		git,

		/** Run arbitrary JS file in a separate process */
		runJs: (opts: Optional<RunJsOptions, "jsFile"> = {}) => runJs({
			jsFile: opts.jsFile ?? config.getSingleBinPathFromPackageJson(),
			...opts
		}),

		/** Start long-running process from JS file. */
		startJsProcess: (opts: Optional<StartJsProcessOptions, "jsFile"> = {}) => startJsProcess({
			jsFile: opts.jsFile ?? config.getSingleBinPathFromPackageJson(),
			...opts
		}),

		/** Run a shell command */
		runShell,

		/** Wraps another function.
		If a function call happens while previous function call is still working - the call is queued.
		Only one call may be queued at a time; subsequent calls are lost. */
		oneAtATime,

		/** Add NodeJS shebang (#!/usr/bin/env node) to a file that is supposed to be executable.
		Expects the files to be present in target directory.
		Defaults to all files mentioned in "bin" field of package.json */
		addNodeShebang: stats.wrap("add node shebang", async(opts: {jsFile?: string | string[]} = {}) => {
			const files = Array.isArray(opts.jsFile) ? opts.jsFile : opts.jsFile ? [opts.jsFile] : config.getBinPathsFromPackageJson()
			if(files.length === 0){
				throw new Error("No files are passed, and also no files are defined in \"bin\" field of package.json. Nothing to add shebang to.")
			}
			for(const file of files){
				const fullPath = Path.resolve(config.target, file)
				let content = await Fs.promises.readFile(fullPath, "utf-8")
				content = "#!/usr/bin/env node\n\n" + content
				await Fs.promises.writeFile(fullPath, content, "utf-8")
			}
		}),

		/** Remove some fields from package.json that no-one needs in published package, like "scripts" or "devDependenices".
		Puts result into a new file in target directory. */
		cutPackageJson: stats.wrap("cut package.json", (opts: Optional<Parameters<typeof cutPackageJson>[0], "output"> = {}) => cutPackageJson({
			input: config.packageJson,
			output: Path.resolve(config.target, "package.json"),
			isSilent: true,
			...opts
		}), () => getFileSizeStr(Path.resolve(config.target, "package.json"))),

		/** Generate type definitions file from entrypoint */
		generateDts: stats.wrap("generate .d.ts", (options: Optional<GenerateDtsOptions, "inputFile" | "outputFile" | "tsconfigPath"> = {}) => generateDts({
			tsconfigPath: config.tsconfig,
			...options,
			inputFile: config.getSingleTypescriptEntrypoint(options.inputFile),
			outputFile: config.getDtsPath(options.outputFile)
		}), (_, options = {}) => getFileSizeStr(config.getDtsPath(options.outputFile))),

		/** Run TypeScript typechecker on all the sources in the project. */
		typecheck: stats.wrap("typecheck", (options: Optional<TypecheckOptions, "directory" | "tsconfig"> = {}) => typecheck({
			tsconfig: config.tsconfig,
			...options,
			directory: config.getSourcesRoot(options.directory)
		})),

		/** Gather all .test.ts(x) files in the project and reference them in a single .ts file */
		generateTestEntrypoint: stats.wrap("generate test entrypoint", (options: Optional<TestEntrypointGenerationOptions, "generatedTestEntrypointPath" | "sourcesRoot"> = {}) => generateTestEntrypoint({
			...options,
			sourcesRoot: config.getGeneratedSourcesRoot(options.sourcesRoot),
			generatedTestEntrypointPath: config.getTestEntrypoint(options.generatedTestEntrypointPath)
		}), (_, options = {}) => config.getTestEntrypoint(options.generatedTestEntrypointPath)),

		/** Run tests from selected .test.ts(x) files */
		runTests: stats.wrap("run tests", async(options: Optional<TestRunOptions, "generatedTestEntrypointPath" | "sourcesRoot" | "testJsFilePath"> = {}) => await runTests({
			sourcesRoot: config.getSourcesRoot(),
			testJsFilePath: config.testJs,
			...options,
			buildOptions: await config.getBuildOptions(options.buildOptions),
			generatedTestEntrypointPath: config.getTestEntrypoint(options.generatedTestEntrypointPath)
		})),

		npm: {
			publish: stats.wrap("npm publish", (options: Optional<NpmPublishOptions, "directory"> = {}) => npmPublish({
				directory: config.target,
				...options
			})),

			install: stats.wrap("npm install", (options: NpmInstallOptions = {}) => npmInstall(options))
		},

		/** Build a project from sources, starting at entrypoint */
		build: stats.wrap("build", async(options: Partial<CustomBuildOptions> = {}) => {
			await tryBuildIconFont(options.iconFont)
			return await Esbuild.build(await config.getBuildOptions(options))
		}, () => getFileSizeStr(Path.resolve(config.target, config.packageJsonContent.main))),

		/** Generate icon font. */
		buildIconFont: stats.wrap("icons", tryBuildIconFont),

		/** Build a project from sources, starting at entrypoint; watch over the source files and rebuild as they change.
		If there are icon params, icons will be watched too. */
		watch: async(options: Partial<CustomBuildOptions> = {}) => {
			prependToHandler(options.onBuildEnd, await tryWatchIconFont(options.iconFont))
			return await buildWatch(await config.getBuildOptions(options))
		},

		/** The same as watch(), but for icons only.
		@returns function to stop watching. */
		watchIconFont: tryWatchIconFont,

		/** Start an HTTP server to serve build artifacts; rebuilds on each request. */
		serve: async(serveOptions: Esbuild.ServeOptions = {}, options: Partial<CustomBuildOptions> = {}) => {
			prependToHandler(options.onBuildEnd, await tryWatchIconFont(options.iconFont))

			const ctx = await Esbuild.context(await config.getBuildOptions(options))
			const serveResult = await ctx.serve({
				servedir: config.target,
				host: "localhost",
				...serveOptions
			})
			console.log(`Serving at http://${serveResult.host}:${serveResult.port}`)
			return [serveResult, ctx]
		},

		/** Delete everything from target directory */
		clear: stats.wrap("clear", async(options: {directory?: string} = {}) => {
			await Fs.promises.rm(options.directory ?? config.target, {force: true, recursive: true})
		}),

		/** Copy files to target directory, retaining filenames. */
		copyToTarget: stats.wrap("copy to target", async(...files: string[]) => {
			await Promise.all(files.map(async file => {
				const name = Path.basename(file)
				const targetPath = Path.resolve(config.target, name)
				await Fs.promises.copyFile(file, targetPath)
			}))
		}, async(_, ...files) => (await Promise.all(files.map(file => getFileSizeStr(file)))).join(" + ")),

		printStats: () => console.log(stats.print()),

		symlink: (args: Optional<SymlinkOptions, "to">) => {
			const defaultTo = Path.resolve(config.target, Path.basename(args.from))
			return symlink({to: defaultTo, ...args})
		},
		isFileExists,
		isDirectoryExists,
		isSymlinkExists,

		systemd: {
			generateExecCommand: (opts: Optional<GenerateSystemdExecCommandOptions, "jsPath"> = {}) => generateSystemdExecCommand({
				jsPath: opts.jsPath ?? config.getSingleBinPathFromPackageJson(),
				nodeVersion: config.packageJsonContent.engines?.node,
				...opts
			}),
			generateServiceConfig: (opts: Optional<GenerateServiceSystemdConfigOptions, "outputPath"> = {}) => generateServiceSystemdConfig({
				execStart: opts.execStart ?? buildUtils.systemd.generateExecCommand(),
				outputPath: config.systemdConfigPath,
				...opts
			}),
			installService: (opts: Optional<InstallSystemdConfigOptions, "configPath">) => installSystemdService({
				configPath: config.systemdConfigPath,
				...opts
			}),
			start: wrapSystemdAction(systemdStart),
			restart: wrapSystemdAction(systemdRestart),
			stop: wrapSystemdAction(systemdStop),
			status: wrapSystemdAction(systemdStatus),
			command: systemdCommand
		}
	}

	return buildUtils
}

