import * as Path from "path"
import * as Fs from "fs"
import * as JSONC from "jsonc-parser"
import * as Esbuild from "esbuild"

import {generateDts, GenerateDtsOptions} from "build_utils/dts"
import {npx} from "build_utils/npx"
import {runJs} from "build_utils/run_js"
import {generateTestEntrypoint, runTests, TestEntrypointGenerationOptions, TestRunOptions} from "build_utils/testing"
import {typecheck, TypecheckOptions} from "build_utils/typecheck"
import {runShell} from "shell"
import {BuildOptionsWithHandlers, buildWatch, omitBuildHandlers} from "build_utils/esbuild"
import {publishToNpm, PublishToNpmOptions} from "build_utils/npm"
import {oneAtATime} from "utils"
import {cutPackageJson} from "@nartallax/package-cutter"
import {StatsCollector} from "build_utils/stats"

type BuildUtilsDefaults = {
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
}

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** Creates a version of all build utils that have defaults for most mandatory parameters.
Also adds some more utility functions that makes no sense to have separately of defaults. */
export const buildUtils = ({
	packageJson = "./package.json", target = "./target", ...defaults
}: BuildUtilsDefaults) => {
	const tsconfig = Path.resolve(defaults.tsconfig ?? "./tsconfig.json")
	const tsconfigContent = parseJsoncOrThrow(Fs.readFileSync(tsconfig, "utf-8"), tsconfig)
	const packageJsonContent = JSON.parse(Fs.readFileSync(packageJson, "utf-8"))
	const testJs = defaults.testJs ?? Path.resolve(target, "./test.js")

	const tsRegexp = /\.tsx?$/i

	const getSourcesRoot = (override?: string): string => {
		if(override){
			return override
		}
		if(defaults.sources){
			return defaults.sources
		}
		if(tsconfigContent.compilerOptions.rootDir){
			return tsconfigContent.compilerOptions.rootDir
		}
		throw new Error("Path to sources root is not passed, and cannot be deduced from tsconfig.json content (there's no \"rootDir\" field in \"compilerOptions\"). Need to know sources root to proceed.")
	}

	const getDtsPath = (override?: string): string => {
		if(override){
			return override
		}
		if(defaults.dtsPath){
			return defaults.dtsPath
		}
		if(packageJsonContent.types){
			return Path.resolve(target, packageJsonContent.types)
		}
		throw new Error("Path to output .d.ts file is not passed, and there's no \"types\" field in package.json to determine filename; don't know where to put generated file.")
	}

	const getGeneratedSourcesRoot = (override?: string): string => {
		if(override){
			return override
		}
		return defaults.generatedSources ?? Path.resolve(getSourcesRoot(), "./generated")
	}

	const getTestEntrypoint = (override?: string): string => {
		if(override){
			return override
		}
		return defaults.testEntrypoint ?? Path.resolve(getGeneratedSourcesRoot(), "./test.ts")
	}

	const getEntrypoints = (buildOptions: Partial<Esbuild.BuildOptions>): string[] | {in: string, out: string}[] => {
		const entryPoints = (buildOptions)?.entryPoints ?? []
		if(!Array.isArray(entryPoints)){
			// this check is here because of weird typings
			// typings imply that the following is absolutely correct:
			// 		entryPoints: {a: "test.ts", b: "main.ts", c: "owo.tsx"}
			// but I can't find any docs about how this should work
			// that's why it's better to just ask user for proper config
			throw new Error("Non-array entryPoints are not supported.")
		}
		return entryPoints
	}

	const getBuildOptions = async(overrides?: Partial<BuildOptionsWithHandlers>) => {
		const defaultBuildOptions = defaults.defaultBuildOptions ?? {
			bundle: true,
			format: packageJsonContent.type === "module" ? "esm" : "cjs",
			platform: "neutral",
			packages: "external"
		}

		let defaultEntryPoints = getEntrypoints(defaultBuildOptions)
		if(defaultEntryPoints.length === 1){
			const entryPointFile = defaultEntryPoints[0]
			if(typeof(entryPointFile) === "string" && tsRegexp.test(entryPointFile)){
				// this is a case of library-project. we should rename output file to what's in package.json, if any
				if(packageJsonContent.main){
					let outName: string = packageJsonContent.main
					const ext = Path.extname(outName)
					if(ext){
						outName = outName.substring(0, outName.length - ext.length)
					}
					// FIXME: resolve to ./target here?
					defaultEntryPoints = [{in: entryPointFile, out: outName}]
				}
			}
		}

		const plugins = defaultBuildOptions?.plugins ?? []
		plugins.push(...overrides?.plugins ?? [])

		if(overrides?.entryPoints){
			const actualEntrypoints = getEntrypoints(overrides)
			const htmlEntrypoints = actualEntrypoints
				.map(x => typeof(x) === "string" ? x : x.in)
				.filter(file => /\.html$/i.test(file))
			if(htmlEntrypoints.length > 0){
				const htmlPlugin = (await import("@chialab/esbuild-plugin-html")).default()
				if(!plugins.some(plugin => plugin.name === htmlPlugin.name)){
					plugins.push(htmlPlugin)
				}
			}
		}

		const dfltOnBuildEnd = defaultBuildOptions.onBuildEnd
		const ovrdOnBuildEnd = overrides?.onBuildEnd
		if(dfltOnBuildEnd || ovrdOnBuildEnd){
			plugins.push({
				name: "ts-build-utils-event-handlers",
				setup: ctx => {
					ctx.onEnd(() => {
						ovrdOnBuildEnd?.()
						dfltOnBuildEnd?.()
					})
				}
			})
		}

		return {
			sourceRoot: getSourcesRoot(),
			// outdir is required for serve, and is also used for everything else for consistensy
			outdir: target,
			...omitBuildHandlers(defaultBuildOptions),
			entryPoints: defaultEntryPoints,
			...omitBuildHandlers(overrides ?? {}),
			plugins
		}
	}

	const getBinPathsFromPackageJson = (): string[] => {
		if(!packageJsonContent.bin){
			return []
		}

		if(typeof(packageJsonContent.bin) === "string"){
			return [packageJsonContent.bin]
		}

		return Object.values(packageJsonContent.bin)
	}

	const getSingleTypescriptEntrypoint = (override?: string): string => {
		if(override){
			return override
		}

		const entryPoints = getEntrypoints(defaults.defaultBuildOptions ?? {})
		const entryFiles = entryPoints.map(x => typeof(x) === "string" ? x : x.in)
		const tsEntryFiles = entryFiles.filter(file => tsRegexp.test(file))

		if(tsEntryFiles.length > 1){
			throw new Error("This action expects exactly one TypeScript file entrypoint, hovewer we found several. Please pass a single selected entrypoint explicitly.")
		}

		const result = tsEntryFiles[0]
		if(!result){
			throw new Error("This action expects exactly one TypeScript file entrypoint, hovewer we found none. Please pass a single selected entrypoint explicitly, or add an entrypoint to build options \"entryPoint\" field.")
		}

		return result
	}

	const stats = new StatsCollector()

	const getFileSizeStr = async(path: string): Promise<string> => {
		let stat: Fs.Stats
		try {
			stat = await Fs.promises.stat(path)
		} catch(e){
			void e
			return "-"
		}
		const level = Math.floor(Math.log2(stat.size) / 10)
		const name = ["b", "kb", "mb", "gb", "tb", "pb", "what goes after petabyte? uhhh."][level]
		const size = stat.size / (2 ** (level * 10))
		return `${level === 0 ? size : size.toFixed(2)}${name}`
	}

	return {
		/** Run an npm-installed executable using command-line and npx */
		npx,

		/** Run arbitrary JS file in a separate process */
		runJs,

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
			const files = Array.isArray(opts.jsFile) ? opts.jsFile : opts.jsFile ? [opts.jsFile] : getBinPathsFromPackageJson()
			if(files.length === 0){
				throw new Error("No files are passed, and also no files are defined in \"bin\" field of package.json. Nothing to add shebang to.")
			}
			for(const file of files){
				const fullPath = Path.resolve(target, file)
				let content = await Fs.promises.readFile(fullPath, "utf-8")
				content = "#!/usr/bin/env node\n\n" + content
				await Fs.promises.writeFile(fullPath, content, "utf-8")
			}
		}),

		/** Remove some fields from package.json that no-one needs in published package, like "scripts" or "devDependenices".
		Puts result into a new file in target directory. */
		cutPackageJson: stats.wrap("cut package.json", (opts: Optional<Parameters<typeof cutPackageJson>[0], "output"> = {}) => cutPackageJson({
			input: packageJson,
			output: Path.resolve(target, "package.json"),
			isSilent: true,
			...opts
		}), () => getFileSizeStr(Path.resolve(target, "package.json"))),

		/** Generate type definitions file from entrypoint */
		generateDts: stats.wrap("generate .d.ts", (options: Optional<GenerateDtsOptions, "inputFile" | "outputFile" | "tsconfigPath"> = {}) => generateDts({
			tsconfigPath: tsconfig,
			...options,
			inputFile: getSingleTypescriptEntrypoint(options.inputFile),
			outputFile: getDtsPath(options.outputFile)
		}), (_, options = {}) => getFileSizeStr(getDtsPath(options.outputFile))),

		/** Run TypeScript typechecker on all the sources in the project. */
		typecheck: stats.wrap("typecheck", (options: Optional<TypecheckOptions, "directory" | "tsconfig"> = {}) => typecheck({
			tsconfig,
			...options,
			directory: getSourcesRoot(options.directory)
		})),

		/** Gather all .test.ts(x) files in the project and reference them in a single .ts file */
		generateTestEntrypoint: stats.wrap("generate test entrypoint", (options: Optional<TestEntrypointGenerationOptions, "generatedTestEntrypointPath" | "sourcesRoot"> = {}) => generateTestEntrypoint({
			...options,
			sourcesRoot: getGeneratedSourcesRoot(options.sourcesRoot),
			generatedTestEntrypointPath: getTestEntrypoint(options.generatedTestEntrypointPath)
		}), (_, options = {}) => getTestEntrypoint(options.generatedTestEntrypointPath)),

		/** Run tests from selected .test.ts(x) files */
		runTests: stats.wrap("run tests", async(options: Optional<TestRunOptions, "generatedTestEntrypointPath" | "sourcesRoot" | "testJsFilePath"> = {}) => await runTests({
			sourcesRoot: getSourcesRoot(),
			testJsFilePath: testJs,
			...options,
			buildOptions: await getBuildOptions(options.buildOptions),
			generatedTestEntrypointPath: getTestEntrypoint(options.generatedTestEntrypointPath)
		})),

		/** Publish contents of target directory to NPM */
		publishToNpm: stats.wrap("publish to npm", (options: Optional<PublishToNpmOptions, "directory"> = {}) => publishToNpm({
			directory: target,
			...options
		})),

		/** Build a project from sources, starting at entrypoint */
		build: stats.wrap("build", async(options: Partial<BuildOptionsWithHandlers> = {}) => {
			return await Esbuild.build(await getBuildOptions(options))
		}, () => getFileSizeStr(Path.resolve(target, packageJsonContent.main))),

		/** Build a project from sources, starting at entrypoint; watch over the source files and rebuild as they change */
		watch: async(options: Partial<BuildOptionsWithHandlers> = {}) => await buildWatch(await getBuildOptions(options)),

		/** Start an HTTP server to serve build artifacts; rebuilds on each request. */
		serve: async(serveOptions: Esbuild.ServeOptions = {}, options: Partial<BuildOptionsWithHandlers> = {}) => {
			const ctx = await Esbuild.context(await getBuildOptions(options))
			const serveResult = await ctx.serve({
				servedir: target,
				host: "localhost",
				...serveOptions
			})
			console.log(`Serving at http://${serveResult.host}:${serveResult.port}`)
			return [serveResult, ctx]
		},

		/** Delete everything from target directory */
		clear: stats.wrap("clear", async(options: {directory?: string} = {}) => {
			await Fs.promises.rm(options.directory ?? target, {force: true, recursive: true})
		}),

		/** Copy files to target directory, retaining filenames. */
		copyToTarget: stats.wrap("copy to target", async(...files: string[]) => {
			await Promise.all(files.map(async file => {
				const name = Path.basename(file)
				const targetPath = Path.resolve(target, name)
				await Fs.promises.copyFile(file, targetPath)
			}))
		}, async(_, ...files) => (await Promise.all(files.map(file => getFileSizeStr(file)))).join(" + ")),

		printStats: () => console.log(stats.print())
	}
}

export const parseJsoncOrThrow = (jsoncString: string, filePath?: string) => {
	const errors: JSONC.ParseError[] = []
	const parsingResult = JSONC.parse(
		jsoncString,
		errors,
		{allowTrailingComma: true}
	)
	if(errors.length > 0){
		const {error: errorCode, offset} = errors[0]!
		const errName = JSONC.printParseErrorCode(errorCode)
		throw new Error(
			`Cannot parse ${filePath ?? JSONC}: got ${errName} at position ${offset}`
		)
	}
	return parsingResult
}