import {runShell, ShellRunOptions} from "shell"

export type NpmPublishOptions = Omit<ShellRunOptions, "cwd" | "executable" | "args"> & {
	directory: string
	dryRun?: boolean
}

export const npmPublish = async(options: NpmPublishOptions) => {
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

export type NpmInstallOptions = Omit<ShellRunOptions, "executable" | "args"> & {
	package?: string
}

export const npmInstall = async(options: NpmInstallOptions) => {
	const args = ["install"]
	if(options.package){
		args.push(options.package)
	}
	await runShell({
		...options,
		executable: "npm",
		args,
		exitOnError: options.exitOnError ?? true
	})
}

export type NpmLinkOptions = Omit<ShellRunOptions, "executable" | "args"> & {
	paths?: string[]
}

export const npmLink = async(options: NpmLinkOptions) => {
	const args = ["link"]
	if(options.paths){
		args.push(...options.paths)
	}
	await runShell({
		...options,
		executable: "npm",
		args,
		exitOnError: options.exitOnError ?? true
	})
}