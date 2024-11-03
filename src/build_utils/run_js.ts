import * as Process from "process"
import * as ChildProcess from "child_process"
import {runShell, ShellRunOptions, startProcess} from "shell"

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

export type JsProcess = {
	restart: () => Promise<void>
	getProcess: () => ChildProcess.ChildProcess | null
}

export type StartJsProcessOptions = RunJsOptions & {
	jsFile: string
	nodeJsPath?: string
	restartSignal?: NodeJS.Signals
}

export const startJsProcess = async(options: StartJsProcessOptions): Promise<JsProcess> => {
	let process: ChildProcess.ChildProcess | null = null

	const startIt = async() => {
		process = await startProcess({
			...options,
			executable: options.nodeJsPath ?? Process.argv[0]!,
			args: [options.jsFile, ...(options.args ?? [])]
		})
	}

	await startIt()

	return {
		getProcess: () => process,
		restart: () => {
			if(process){
				const proc = process
				return new Promise(ok => {
					proc.once("exit", async() => {
						await startIt()
						ok()
					})
					proc.kill(options.restartSignal ?? "SIGINT")
				})

			} else {
				return startIt()
			}
		}
	}
}