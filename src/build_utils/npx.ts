import {runShell, ShellRunOptions} from "shell"

export type NpxRunOptions = Omit<ShellRunOptions, "executable" | "args">

export const npx = async(args: string[], opts: NpxRunOptions = {}) => {
	return await runShell({
		executable: "npx",
		args,
		...opts,
		exitOnError: opts.exitOnError ?? true
	})
}