import * as Chokidar from "chokidar"
import * as Esbuild from "esbuild"
import {omit} from "utils"

export type BuildOptionsWithHandlers = Esbuild.BuildOptions & {
	onBuildEnd?: () => void
}

export const omitBuildHandlers = <T extends BuildOptionsWithHandlers>(options: T) => omit(options, "onBuildEnd")

export type BuildWatchOptions = BuildOptionsWithHandlers & {
	/** How would you like to watch for changes?
	"fs-events" (default) uses OS API to receive updates. Faster.
	"polling" is esbuild built-in polling-based approach to detecting updates. More compatible with exotic OSes. */
	watchMode?: "polling" | "fs-events"
}

export const buildWatch = async(options: BuildWatchOptions): Promise<Esbuild.BuildContext> => {
	const watchMode = options.watchMode ?? "fs-events"
	const buildOptions = omit(options, "watchMode", "onBuildEnd")
	const ctx = await Esbuild.context(buildOptions)
	if(watchMode === "polling"){
		await ctx.watch()
	} else {
		const sourceRoot = options.sourceRoot
		if(!sourceRoot){
			throw new Error("Cannot watch sources with filesystem events if source root is not passed.")
		}

		// wonder if I should tune awaitWriteFinish timings
		const watcher = Chokidar.watch([sourceRoot], {awaitWriteFinish: true}).on("all", async() => {
			try {
				await ctx.rebuild()
			} catch(e){
				// nothing. all build errors are already reported into stdout
				// but if we don't catch this, process will exit, which is usually undesireable
				void e
			}
		})

		// would be nice to have an event for that. oh well.
		const nativeDispose = ctx.dispose
		ctx.dispose = async function monkeypatchedDispose(...args: Parameters<typeof nativeDispose>) {
			await watcher.close()
			return await nativeDispose.call(this, ...args)
		}
	}

	return ctx
}