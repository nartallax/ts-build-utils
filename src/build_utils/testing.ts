import type * as Esbuild from "esbuild"
import {Clamsensor} from "@nartallax/clamsensor"

export type TestEntrypointGenerationOptions = {
	sourcesRoot: string
	generatedTestEntrypointPath: string
}

export const generateTestEntrypoint = async(options: TestEntrypointGenerationOptions) => {
	return await Clamsensor.generateClamsensorBundleFile({
		testDirPath: options.sourcesRoot,
		resultPath: options.generatedTestEntrypointPath
	})
}


export type TestRunOptions = TestEntrypointGenerationOptions & {
	buildOptions?: Omit<Esbuild.BuildOptions, "entryPoints" | "outfile" | "outdir">
	testJsFilePath: string
	nameFilter?: string
	showStackTraces?: boolean
}

export const runTests = async(options: TestRunOptions) => {
	const Esbuild = await import("esbuild")

	await generateTestEntrypoint(options)
	await Esbuild.build({
		...options.buildOptions ?? {},
		entryPoints: [options.generatedTestEntrypointPath],
		outdir: undefined,
		outfile: options.testJsFilePath
	})
	const bundle = await Clamsensor.importBundle(options.testJsFilePath)
	await bundle.runClamsensorBundle({filter: options.nameFilter, noStackTraces: !(options.showStackTraces ?? true)})
}