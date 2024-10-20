import {npx, NpxRunOptions} from "build_utils/npx"
import {runJs} from "build_utils/run_js"
import * as Esbuild from "esbuild"

export type TestEntrypointGenerationOptions = NpxRunOptions & {
	sourcesRoot: string
	generatedTestEntrypointPath: string
}

export const generateTestEntrypoint = async(options: TestEntrypointGenerationOptions) => {
	return await npx(["clamsensor_codegen", options.sourcesRoot, options.generatedTestEntrypointPath], options)
}


export type TestRunOptions = TestEntrypointGenerationOptions & {
	buildOptions?: Omit<Esbuild.BuildOptions, "entryPoints" | "outfile" | "outdir">
	testJsFilePath: string
	nameFilter?: string
}

export const runTests = async(options: TestRunOptions) => {
	await generateTestEntrypoint(options)
	await Esbuild.build({
		...options.buildOptions ?? {},
		entryPoints: [options.generatedTestEntrypointPath],
		outdir: undefined,
		outfile: options.testJsFilePath
	})
	return await runJs({
		jsFile: options.testJsFilePath,
		exitOnError: options.exitOnError ?? true,
		args: !options.nameFilter ? [] : [options.nameFilter]
	})
}