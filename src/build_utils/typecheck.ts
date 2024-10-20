import {npx, NpxRunOptions} from "build_utils/npx"

export type TypecheckOptions = Omit<NpxRunOptions, "cwd"> & {
	directory: string
}

export const typecheck = async(options: TypecheckOptions) => {
	options.exitOnError ??= true
	return await npx(["tsc", "--noEmit"], {
		...options,
		exitOnError: options.exitOnError ?? true,
		cwd: options.directory
	})
}