import * as Chokidar from "chokidar"
import * as Esbuild from "esbuild"
import {omit} from "utils"

export type BuildWatchOptions = Esbuild.BuildOptions & {
	/** How would you like to watch for changes?
	"fs-events" (default) uses OS API to receive updates. Faster.
	"polling" is esbuild built-in polling-based approach to detecting updates. More compatible with exotic OSes. */
	watchMode?: "polling" | "fs-events"
}

export const buildWatch = async(options: BuildWatchOptions): Promise<Esbuild.BuildContext> => {
	const watchMode = options.watchMode ?? "fs-events"
	const buildOptions = omit(options, "watchMode")
	const ctx = await Esbuild.context(buildOptions)
	if(watchMode === "polling"){
		await ctx.watch()
	} else {
		const sourceRoot = options.sourceRoot
		if(!sourceRoot){
			throw new Error("Cannot watch sources with filesystem events if source root is not passed.")
		}

		const watcher = Chokidar.watch([sourceRoot]).on("all", () => {
			void ctx.rebuild()
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