import {runShell, ShellRunOptions} from "shell"

export type PublishToNpmOptions = Omit<ShellRunOptions, "cwd" | "executable" | "args"> & {
	directory: string
	dryRun?: boolean
}

export const publishToNpm = async(options: PublishToNpmOptions) => {
	const args = ["publish", "--access", "public"]
	if(options.dryRun){
		args.push("--dry-run")
	}
	await runShell({
		...options,
		executable: "npm",
		args,
		cwd: options.directory,
		exitOnError: options.exitOnError ?? true
	})
}