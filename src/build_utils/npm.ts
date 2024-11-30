import {runShell, ShellRunOptions} from "shell"
import * as Path from "path"
import * as Fs from "fs/promises"
import {isSymlinkExists} from "build_utils/fs_utils"

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
	/** If enabled, paths are passed, and linked packages are already present in node_modules, `npm link` will be skipped
	This is useful in case npm commands are laggy */
	skipIfPresent?: boolean
}

export const npmLink = async(options: NpmLinkOptions) => {
	const args = ["link"]
	if(options.paths){
		args.push(...options.paths)
		if(options.paths.length > 0 && options.skipIfPresent){
			const skippablePackages = (await Promise.all(options.paths.map(async packageDirPath => {
				const packageJsonPath = Path.resolve(packageDirPath, "package.json")
				const packageJson = JSON.parse(await Fs.readFile(packageJsonPath, "utf-8"))
				const name = packageJson.name
				if(typeof(name) !== "string"){
					throw new Error(`Expected package.json at ${packageJsonPath} to have "name" field with string value.`)
				}

				const packagePath = Path.resolve("./node_modules", name)
				if(await isSymlinkExists(packagePath) && await Fs.realpath(packagePath) === await Fs.realpath(packageDirPath)){
					return name
				}
				return null

			}))).filter(x => !!x)

			if(skippablePackages.length === options.paths.length){
				return
			}
		}
	}
	await runShell({
		...options,
		executable: "npm",
		args,
		exitOnError: options.exitOnError ?? true
	})
}

export type NpmRunOptions = Omit<ShellRunOptions, "executable" | "args"> & {
	args: string[]
}

export const npmRun = async(options: NpmRunOptions) => {
	await runShell({
		...options,
		executable: "npm",
		args: ["run", ...options.args],
		exitOnError: options.exitOnError ?? true
	})
}