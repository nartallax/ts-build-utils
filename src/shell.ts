import type * as ChildProcess from "child_process"
import type * as Stream from "stream"
import type * as Readline from "readline"
import ShellEscape from "shell-escape"

export type ShellRunResult = {
	exitCode: number | null
	signal: NodeJS.Signals | null
}

export type ShellRunOptions = {
	/** Path to executable, or its name if it should be globally available */
	executable: string
	/** CLI arguments that will be passed to the executable */
	args?: string[]
	/** Working directory the command will be launched in. */
	cwd?: string
	/** Environment variables to be passed to the process. */
	env?: NodeJS.ProcessEnv
	/** If true, process.exit(1) will be called if this shell command exits with nonzero exit code, or is killed via signal.
	Most of the build utils have this set to true by default (but that's overrideable). */
	exitOnError?: boolean
	onStdout?: (line: string) => void
	onStderr?: (line: string) => void
}

export const runShell = (opts: ShellRunOptions): Promise<ShellRunResult> => {
	return startProcess(opts).then(proc => new Promise((resolve, reject) => {
		proc.on("error", reject)

		proc.on("exit", (code, signal) => {
			if(code || signal){
				if(opts.exitOnError){
					process.exit(1)
				}
				const commandStr = ShellEscape([opts.executable, ...opts.args ?? []])
				const exitedWith = code === null ? `signal ${signal}` : `code ${code}`
				reject(new Error(`${commandStr} exited with ${exitedWith}`))
				return
			}

			resolve({exitCode: code, signal})
		})
	}))
}

export const startProcess = async(opts: ShellRunOptions) => {
	const Process = await import("process")
	const ChildProcess = await import("child_process")
	const Readline = await import("readline")

	let binaryPath = opts.executable
	const cliArgs = opts.args ?? []
	const spawnOpts: ChildProcess.SpawnOptions = {
		cwd: opts.cwd ?? ".",
		env: opts.env,
		stdio: ["ignore", opts.onStdout ? "pipe" : "inherit", opts.onStderr ? "pipe" : "inherit"]
	}

	if(process.platform === "win32"){
		spawnOpts.shell = true
		binaryPath = `"${binaryPath}"` // in case of spaces in path
	}

	const proc = ChildProcess.spawn(binaryPath, cliArgs, spawnOpts)

	proc.on("exit", () => {
		stdoutReader?.close()
		stdoutReader = null
		stderrReader?.close()
		stderrReader = null
	})

	const {onStderr, onStdout} = opts
	let stdoutReader = createReadline(Readline, proc.stdout, !onStdout ? undefined : line => {
		Process.stdout.write(line + "\n")
		onStdout(line)
	})
	let stderrReader = createReadline(Readline, proc.stderr, !onStderr ? undefined : line => {
		Process.stderr.write(line + "\n")
		onStderr(line)
	})

	return proc
}

const createReadline = (rl: typeof Readline, stream: Stream.Readable | null, handler?: (line: string) => void): Readline.Interface | null => {
	if(!stream || !handler){
		return null
	}

	const result = rl.createInterface({input: stream})
	result.on("line", handler)
	return result
}