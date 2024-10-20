import * as Process from "process"
import * as ChildProcess from "child_process"
import * as Stream from "stream"
import * as Readline from "readline"

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
	/** If true, process.exit(1) will be called if this shell command exits with nonzero exit code, or is killed via signal.
	Most of the build utils have this set to true by default (but that's overrideable). */
	exitOnError?: boolean
	onStdout?: (line: string) => void
	onStderr?: (line: string) => void
}

export const runShell = (opts: ShellRunOptions): Promise<ShellRunResult> => {
	return new Promise((resolve, reject) => {
		const process = startProcess(opts)

		process.on("error", reject)

		process.on("exit", (code, signal) => {
			if(code || signal){
				if(opts.exitOnError){
					Process.exit(1)
				}
				reject(new Error(`${opts.executable} exited with wrong code/signal: code = ${code}, signal = ${signal}`))
				return
			}

			resolve({exitCode: code, signal})
		})
	})
}

const startProcess = (opts: ShellRunOptions) => {
	let binaryPath = opts.executable
	const cliArgs = opts.args ?? []
	const spawnOpts: ChildProcess.SpawnOptions = {
		cwd: opts.cwd ?? ".",
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
	let stdoutReader = createReadline(proc.stdout, !onStdout ? undefined : line => {
		Process.stdout.write(line + "\n")
		onStdout(line)
	})
	let stderrReader = createReadline(proc.stderr, !onStderr ? undefined : line => {
		Process.stderr.write(line + "\n")
		onStderr(line)
	})

	return proc
}

const createReadline = (stream: Stream.Readable | null, handler?: (line: string) => void): Readline.Interface | null => {
	if(!stream || !handler){
		return null
	}

	const result = Readline.createInterface({input: stream})
	result.on("line", handler)
	return result
}