import * as Process from "process"
import * as ChildProcess from "child_process"
import {runShell, ShellRunOptions, startProcess} from "shell"
import * as Crypto from "crypto"
import {promises as Fs} from "fs"

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
	restartIfChanged: () => Promise<void>
	getProcess: () => ChildProcess.ChildProcess | null
}

export type StartJsProcessOptions = RunJsOptions & {
	jsFile: string
	nodeJsPath?: string
	restartSignal?: NodeJS.Signals
}

export const startJsProcess = async(options: StartJsProcessOptions): Promise<JsProcess> => {
	let process: ChildProcess.ChildProcess | null = null

	const getHash = async() => Crypto.createHash("sha256").update(await Fs.readFile(options.jsFile)).digest("hex")

	let lastRunCodeHash = ""
	const updateHash = async(hash?: string) => {
		lastRunCodeHash = hash ?? await getHash()
	}

	const startIt = (hash?: string) => new Promise<void>((ok, bad) => {
		process = startProcess({
			...options,
			executable: options.nodeJsPath ?? Process.argv[0]!,
			args: [options.jsFile, ...(options.args ?? [])]
		})
		process.once("spawn", ok)
		process.once("error", bad)
		process.once("exit", () => {
			process = null
		})

		void updateHash(hash)
	})

	await startIt()

	const restart = (hash?: string) => {
		if(process){
			const proc = process
			return new Promise<void>(ok => {
				proc.once("exit", async() => {
					await startIt(hash)
					ok()
				})
				proc.kill(options.restartSignal ?? "SIGINT")
			})

		} else {
			return startIt(hash)
		}
	}

	const restartIfChanged = async() => {
		const newHash = await getHash()
		if(lastRunCodeHash !== newHash){
			await restart(newHash)
		}
	}

	return {
		getProcess: () => process,
		restart,
		restartIfChanged
	}
}