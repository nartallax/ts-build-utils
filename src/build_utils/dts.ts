import {promises as Fs} from "fs"

export type GenerateDtsOptions = {
	inputFile: string
	outputFile: string
	tsconfigPath: string
	banner?: boolean
	exportReferencedTypes?: boolean
}

export const generateDts = async(options: GenerateDtsOptions) => {
	const result = (await import("dts-bundle-generator")).generateDtsBundle([{
		filePath: options.inputFile,
		output: {
			noBanner: !(options.banner ?? false),
			exportReferencedTypes: options.exportReferencedTypes ?? false
		}
	}], {
		preferredConfigPath: options.tsconfigPath
	})
	if(result.length !== 1){
		throw new Error(`Unexpected output from dts-bundle-generator: ${result.length} entries`)
	}
	const dtsCode = result[0]!
	await Fs.writeFile(options.outputFile, dtsCode, "utf-8")
}