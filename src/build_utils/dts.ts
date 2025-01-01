import {npx} from "build_utils/npx"

export type GenerateDtsOptions = {
	inputFile: string
	outputFile: string
	tsconfigPath: string
	banner?: boolean
	exportReferencedTypes?: boolean
}

export const generateDts = async(options: GenerateDtsOptions) => {
	// it's tempting to `(await import("dts-bundle-generator")).generateDtsBundle(...)`
	// but CLI args have different effect, compared to calling API directly
	// for example, `--export-referenced-types false` in CLI will only prevent exporting referenced-but-not-exported types
	// (as it should be)
	// but `exportReferencedTypes: false` in API will prevent export of all types, even explicitly exported ones
	await npx(
		["dts-bundle-generator",
			options.inputFile,
			...(options.banner ? [] : ["--no-banner"]),
			"--export-referenced-types",
			options.exportReferencedTypes ? "true" : "false",
			"-o",
			options.outputFile,
			"--project",
			options.tsconfigPath],
		{
			exitOnError: true
		}
	)
}