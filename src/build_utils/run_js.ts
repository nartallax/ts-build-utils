import * as Process from "process"
import {runShell, ShellRunOptions} from "shell"

export type RunJsOptions = Omit<ShellRunOptions, "executable"> & {
	jsFile: string
	nodeJsPath?: string
}

export const runJs = async(options: RunJsOptions) => {
	return await runShell({
		executable: options.nodeJsPath ?? Process.argv[0]!,
		args: [options.jsFile, ...(options.args ?? [])]
	})
}