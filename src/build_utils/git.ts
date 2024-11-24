import {runShell, ShellRunOptions} from "shell"

type PullOptions = Omit<ShellRunOptions, "executable" | "args"> & {
	branch?: string
}

export const git = {
	pull: async({branch, ...shellOpts}: PullOptions = {}) => {
		const args = ["pull"]
		if(branch){
			args.push(branch)
		}
		return await runShell({
			...shellOpts, executable: "git", args, exitOnError: shellOpts.exitOnError ?? true
		})
	}
}