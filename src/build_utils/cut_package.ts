import {npx, NpxRunOptions} from "build_utils/npx"

export type CutPackageJsonOptions = NpxRunOptions & {
	inputFile: string
	outputFile: string
	/** List of keys to cut from package.json. Have nice defaults. Keys can contain dots to point to nested objects. */
	keys?: string[]
	/** Without this option input cannot be the same as output */
	sameOutput?: boolean
	/** Pretty-print output JSON */
	pretty?: boolean
}

export const cutPackageJson = async(options: CutPackageJsonOptions) => {
	const args: string[] = ["package-cutter", "--output", options.outputFile]
	if(options.inputFile){
		args.push("--input", options.inputFile)
	}
	if(options.keys){
		options.keys.forEach(key => args.push("--keys", key))
	}
	if(options.sameOutput){
		args.push("--same-output")
	}
	if(options.pretty){
		args.push("--pretty")
	}
	await npx(args, options)
}