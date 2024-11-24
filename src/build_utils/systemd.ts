import {promises as Fs} from "fs"
import {runShell, ShellRunOptions} from "shell"
import * as Path from "path"
import ShellEscape from "shell-escape"
import {isSymlinkExists, symlink} from "build_utils/fs_utils"

export type SystemdCommandBaseOptions = {
	/** By default all systemd commands are user-related */
	isGlobal?: boolean
}

export type SystemdCommandOptions = Omit<ShellRunOptions, "executable" | "args"> & SystemdCommandBaseOptions & {
	args: string[]
}

const systemctlDirEnvName = "XDG_RUNTIME_DIR"

export const systemdCommand = async(opts: SystemdCommandOptions) => {
	const Os = await import("os")
	const env = {...opts.env ?? {}}

	if(!process.env[systemctlDirEnvName]){
		// for some reason XDG_RUNTIME_DIR is sometimes absent
		env[systemctlDirEnvName] = `/run/user/${Os.userInfo().uid}`
	}
	let args = opts.args
	if(!opts.isGlobal){
		args = ["--user", ...args]
	}
	return await runShell({
		...opts, executable: "systemctl", args, env, exitOnError: opts.exitOnError ?? true
	})
}

export type GenerateSystemdExecCommandOptions = {
	jsPath: string
	/** Semver expression expected */
	nodeVersion?: string
	/** Defaults to "bash" */
	shell?: string
	/** Additional arguments to be passed to JS file. */
	args?: string[]
	pipeTo?: string
}

const findMostModernNodeVersionFromSemverRange = async(rangeStr: string): Promise<string> => {
	const range = new((await import("semver")).Range)(rangeStr)
	let bestGuess: string | null = null
	for(const set of range.set){
		for(const entry of set){
			if(!entry.operator.includes("=")){
				continue
			}

			if(bestGuess && entry.semver.version < bestGuess){
				continue
			}

			bestGuess = entry.semver.version
		}
	}

	if(!bestGuess){
		throw new Error(`Failed to deduce NodeJS version number from semver range ${JSON.stringify(rangeStr)}. If the range only uses > and < operators - try using >= operator.`)
	}

	return dropExcessiveVersionPortions(bestGuess)
}

const dropExcessiveVersionPortions = (version: string): string => {
	while(/^(\d+\.?)+$/.test(version) && version.endsWith(".0")){
		version = version.substring(0, version.length - 2)
		// I was thinking about testing with Semver.satisfies if the truncation result is still good, just to be safe
		// but turns out Semver.satisfies("22", ">=22") === false, while Semver.satisfies("22.0.0", ">=22") === true
	}
	return version
}

export const generateSystemdExecCommand = async(opts: GenerateSystemdExecCommandOptions) => {
	let nodeExpr = "node"
	if(opts.nodeVersion){
		const nvmDir = process.env["NVM_DIR"]
		if(!nvmDir){
			throw new Error("nvm (Node Version Manager) is probably not installed (judging by absence of NVM_DIR environment variable). When systemd exec command is generated, nvm is used in cases when node version is specified (and node version can default to package.json's engines.node).")
		}
		const nodeVersion = await findMostModernNodeVersionFromSemverRange(opts.nodeVersion)

		// we have to inline $NVM_DIR, because it's not available when launched from within systemd script, not sure why
		// it may cause problems when generating global (aka root) service definitions, because $NVM_DIR could point to local user dir
		const nvmshPath = Path.resolve(nvmDir, "nvm.sh")
		nodeExpr = `. ${ShellEscape([nvmshPath])}; nvm run ${ShellEscape([nodeVersion])}`
	}
	const jsExpr = ShellEscape([opts.jsPath, ...opts.args ?? []])
	let pipeExpr = ""
	if(opts.pipeTo){
		pipeExpr = ` > ${ShellEscape([opts.pipeTo])} 2>&1`
	}
	const shellCommand = `${nodeExpr} ${jsExpr}${pipeExpr}`
	return ShellEscape(["/usr/bin/env", opts.shell ?? "bash", "-c", shellCommand])
}

export type GenerateServiceSystemdConfigOptions = {
	outputPath: string
	description?: string
	/** Defaults to "simple" */
	serviceType?: string
	workingDirectory?: string
	execStart?: string | string[]
	/** Defaults to "always" */
	restart?: "string"
	/** Defaults to "network.target" */
	after?: string
	/** Defaults to "default.target" */
	wantedBy?: string
}

export const generateServiceSystemdConfig = async(opts: GenerateServiceSystemdConfigOptions) => {
	const execStart = !opts.execStart ? [] : typeof(opts.execStart) === "string" ? [opts.execStart] : opts.execStart
	const config = `
[Unit]
Description=${opts.description ?? ""}
After=${opts.after ?? "network.target"}

[Service]
Type=${opts.serviceType ?? "simple"}
Restart=${opts.restart ?? "always"}
${!opts.workingDirectory ? "" : "WorkingDirectory=" + opts.workingDirectory + "\n"}${execStart.map(cmd => `ExecStart=${cmd}`).join("\n")}


[Install]
WantedBy=${opts.wantedBy ?? "default.target"}
`
	await Fs.writeFile(opts.outputPath, config, "utf-8")
}

export type InstallSystemdConfigOptions = SystemdCommandBaseOptions & {
	configPath: string
}

export const installSystemdService = async({configPath, ...opts}: InstallSystemdConfigOptions) => {
	const Os = await import("os")

	const serviceFileName = Path.basename(configPath)
	const serviceSymlinkTarget = opts.isGlobal
		? Path.resolve("/etc/systemd/user", serviceFileName)
		: Path.resolve(Os.homedir(), ".config/systemd/user/", serviceFileName)

	if(!(await isSymlinkExists(serviceSymlinkTarget))){
		// directory could not exist if it's first ever service of this user
		await Fs.mkdir(Path.dirname(serviceSymlinkTarget), {recursive: true})
		await symlink({from: configPath, to: serviceSymlinkTarget})
		await systemdCommand({...opts, args: ["enable", serviceFileName]})
	} else {
		await systemdCommand({...opts, args: ["daemon-reload"]})
	}
}

export type SystemdServiceActionOptions = SystemdCommandBaseOptions & {
	serviceName: string
}

export const systemdStatus = async({serviceName, ...opts}: SystemdServiceActionOptions) => {
	await systemdCommand({...opts, args: ["status", serviceName]})
}

export const systemdRestart = async({serviceName, ...opts}: SystemdServiceActionOptions) => {
	await systemdCommand({...opts, args: ["restart", serviceName]})
}

export const systemdStart = async({serviceName, ...opts}: SystemdServiceActionOptions) => {
	await systemdCommand({...opts, args: ["start", serviceName]})
}

export const systemdStop = async({serviceName, ...opts}: SystemdServiceActionOptions) => {
	await systemdCommand({...opts, args: ["stop", serviceName]})
}