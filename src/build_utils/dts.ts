import {npx, NpxRunOptions} from "build_utils/npx"

export type GenerateDtsOptions = NpxRunOptions & {
	inputFile: string
	outputFile: string
	tsconfigPath: string
	banner?: boolean
	exportReferencedTypes?: boolean
}

export const generateDts = async(options: GenerateDtsOptions) => {
	const args = [
		"dts-bundle-generator",
		"--out-file",
		options.outputFile,
		"--project",
		options.tsconfigPath
	]
	if(!options.banner){
		args.push("--no-banner")
	}
	if(!options.exportReferencedTypes){
		args.push("--export-referenced-types=false")
	}
	args.push(options.inputFile)
	return await npx(args, options)
}