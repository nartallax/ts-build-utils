import {BuildUtilsDefaults, IconParams, omitCustomBuildOptions} from "defaults"
import * as Path from "path"
import type * as Esbuild from "esbuild"
import type * as JSONC from "jsonc-parser"
import {BuildOptionsWithHandlers} from "build_utils/esbuild"

export type ConfigUtils = ReturnType<typeof getConfigUtils>

export const getConfigUtils = (defaults: BuildUtilsDefaults) => {
	const target = Path.resolve(defaults.target ?? "./target")
	const packageJson = Path.resolve(defaults.packageJson ?? "./package.json")
	const tsconfig = Path.resolve(defaults.tsconfig ?? "./tsconfig.json")

	const testJs = defaults.testJs ?? Path.resolve(target, "./test.js")

	const tsRegexp = /\.tsx?$/i

	let tsconfigContent: string | null = null
	const getTsconfigContent = async() => {
		return tsconfigContent ??= await parseJsoncOrThrow(await((await import("fs")).promises).readFile(tsconfig, "utf-8"), tsconfig)
	}

	let packageJsonContent: string | null = null
	const getPackageJsonContent = async() => {
		return packageJsonContent ??= JSON.parse(await((await import("fs")).promises).readFile(packageJson, "utf-8"))
	}

	const getSourcesRoot = async(override?: string): Promise<string> => {
		if(override){
			return override
		}
		if(defaults.sources){
			return defaults.sources
		}
		const tsconfigContent = await getTsconfigContent()
		if(tsconfigContent.compilerOptions.rootDir){
			return tsconfigContent.compilerOptions.rootDir
		}
		throw new Error("Path to sources root is not passed, and cannot be deduced from tsconfig.json content (there's no \"rootDir\" field in \"compilerOptions\"). Need to know sources root to proceed.")
	}

	const getDtsPath = async(override?: string): Promise<string> => {
		if(override){
			return override
		}
		if(defaults.dtsPath){
			return defaults.dtsPath
		}
		if((await getPackageJsonContent()).types){
			return Path.resolve(target, (await getPackageJsonContent()).types)
		}
		throw new Error("Path to output .d.ts file is not passed, and there's no \"types\" field in package.json to determine filename; don't know where to put generated file.")
	}

	const getGeneratedSourcesRoot = async(override?: string): Promise<string> => {
		if(override){
			return override
		}
		return defaults.generatedSources ?? Path.resolve(await getSourcesRoot(), "./generated")
	}

	const getTestEntrypoint = async(override?: string): Promise<string> => {
		if(override){
			return override
		}
		return defaults.testEntrypoint ?? Path.resolve(await getGeneratedSourcesRoot(), "./test.ts")
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
			format: (await getPackageJsonContent()).type === "module" ? "esm" : "cjs",
			platform: "neutral",
			packages: "external"
		}

		let defaultEntryPoints = getEntrypoints(defaultBuildOptions)
		if(defaultEntryPoints.length === 1){
			const entryPointFile = defaultEntryPoints[0]
			if(typeof(entryPointFile) === "string" && tsRegexp.test(entryPointFile)){
				// this is a case of library-project. we should rename output file to what's in package.json, if any
				const main = (await getPackageJsonContent()).main
				if(main){
					let outName: string = main
					const ext = Path.extname(outName)
					if(ext){
						outName = outName.substring(0, outName.length - ext.length)
					}
					// we are not resolving to ./target here because outdir option is passed
					defaultEntryPoints = [{in: entryPointFile, out: outName}]
				}
			}
		}

		const plugins = defaultBuildOptions?.plugins ?? []
		plugins.push(...overrides?.plugins ?? [])

		const actualEntrypoints = !overrides?.entryPoints ? defaultEntryPoints : getEntrypoints(overrides)
		if(actualEntrypoints){
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
			sourceRoot: await getSourcesRoot(),
			// outdir is required for serve, and is also used for everything else for consistensy
			outdir: target,
			...omitCustomBuildOptions(defaultBuildOptions),
			entryPoints: defaultEntryPoints,
			...omitCustomBuildOptions(overrides ?? {}),
			plugins
		}
	}

	const getBinPathsFromPackageJson = async(): Promise<string[]> => {
		const bin = (await getPackageJsonContent()).bin
		if(!bin){
			return []
		}

		if(typeof(bin) === "string"){
			return [bin]
		}

		return Object.values(bin)
	}

	const getSingleBinPathFromPackageJson = async(): Promise<string> => {
		const bins = await getBinPathsFromPackageJson()
		if(bins.length === 0){
			throw new Error("No runnable JS file is defined in package.json, and none passed explicitly.")
		}
		if(bins.length > 1){
			throw new Error(`${bins.length} runnable JS files are defined in package.json; not sure which one to run. Please pass jsFile explicitly.`)
		}
		return Path.resolve(target, bins[0]!)
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

	const getEffectiveIconArgs = (overrides?: IconParams): IconParams | null => {
		if(!overrides && !defaults.icons){
			return null
		}

		return {...(defaults.icons! ?? {}), ...(overrides! ?? {})}
	}

	const getPackageNameWithoutNamespace = async() => {
		let name: string = (await getPackageJsonContent()).name
		if(name.startsWith("@")){
			name = name.split("/").slice(1).join("/")
		}
		return name
	}

	const systemdConfigPath = Path.resolve(target, getPackageNameWithoutNamespace() + ".service")

	return {
		target, packageJson, tsconfig, getTsconfigContent, getPackageJsonContent, testJs, systemdConfigPath, getBinPathsFromPackageJson, getSingleTypescriptEntrypoint, getBuildOptions, getDtsPath, getSourcesRoot, getTestEntrypoint, getEffectiveIconArgs, getGeneratedSourcesRoot, getSingleBinPathFromPackageJson, getPackageNameWithoutNamespace
	}
}


const parseJsoncOrThrow = async(jsoncString: string, filePath?: string) => {
	const errors: JSONC.ParseError[] = []
	const JSONC = await import("jsonc-parser")
	const parsingResult = JSONC.parse(
		jsoncString,
		errors,
		{allowTrailingComma: true}
	)
	if(errors.length > 0){
		const {error: errorCode, offset} = errors[0]!
		const errName = JSONC.printParseErrorCode(errorCode)
		throw new Error(
			`Cannot parse ${filePath ?? "JSONC"}: got ${errName} at position ${offset}`
		)
	}
	return parsingResult
}