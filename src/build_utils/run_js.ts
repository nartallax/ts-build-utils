import type * as ChildProcess from "child_process"
import {runShell, ShellRunOptions, startProcess} from "shell"

export type RunJsOptions = Omit<ShellRunOptions, "executable"> & {
	jsFile: string
	nodeJsPath?: string
}

export const runJs = async(options: RunJsOptions) => {
	return await runShell({
		executable: options.nodeJsPath ?? (await import("process")).argv[0]!,
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

	const getHash = async() => (await import("crypto"))
		.createHash("sha256")
		.update(await((await import("fs")).promises).readFile(options.jsFile))
		.digest("hex")

	let lastRunCodeHash = ""
	const updateHash = async(hash?: string) => {
		lastRunCodeHash = hash ?? await getHash()
	}

	const argv0 = (await import("process")).argv[0]!

	const startIt = (hash?: string) => startProcess({
		...options,
		executable: options.nodeJsPath ?? argv0,
		args: [options.jsFile, ...(options.args ?? [])]
	}).then(_process => new Promise<void>((ok, bad) => {
		process = _process
		process.once("spawn", ok)
		process.once("error", bad)
		process.once("exit", () => {
			process = null
		})

		void updateHash(hash)
	}))

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