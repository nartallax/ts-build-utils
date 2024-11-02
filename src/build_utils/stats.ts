type StatsEntry = {
	name: string
	time: number
	message?: string
}

export class StatsCollector {
	private stats: StatsEntry[] = []
	private nowDoing: string[] = []

	addEntry(entry: StatsEntry): void {
		this.stats.push(entry)
	}

	print(): string {
		let lines = this.stats.map(stat => [stat.name, formatMs(stat.time), stat.message ?? ""])
		const longestName = longestAt(lines, 0)
		const longestTime = longestAt(lines, 1)
		lines = lines.map(([name, time, ...rest]) => [
			endPad(name!, longestName),
			endPad(time!, longestTime),
			...rest
		])
		const linesStr = lines.map(line => "  " + line.join("    ")).join("\n")

		const timeSum = this.stats.map(stat => stat.time).reduce((a, b) => a + b, 0)
		const nowDoingStr = this.nowDoing.length === 0
			? `Done in ${formatMs(timeSum)}`
			: `Ongoing ${this.nowDoing.join(", ")}`
		return nowDoingStr + (linesStr.length > 0 ? "\n" : "") + linesStr
	}

	wrap<A extends unknown[], R>(name: string, action: (...args: A) => Promise<R>, getMessage?: (result: R, ...args: A) => string | Promise<string>): (...args: A) => Promise<R> {
		return async(...args: A) => this.measure(name, async() => {
			const result = await action(...args)
			let message = undefined
			if(getMessage){
				message = await Promise.resolve(getMessage(result, ...args))
			}
			return [message, result]
		})
	}

	async measure<R>(name: string, action: () => Promise<[message: string | undefined, R]>): Promise<R>
	async measure<R>(name: string, action: () => Promise<R>): Promise<R>
	async measure(name: string, action: () => Promise<unknown>): Promise<unknown> {
		const index = this.nowDoing.length
		this.nowDoing.push(name)
		try {
			let time = performance.now()
			let result = await action()
			time = performance.now() - time
			let message: string | undefined = undefined
			if(Array.isArray(result) && result.length === 2){
				message = result[0]
				result = result[1]
			}
			this.stats.push({name, time, message})
			return result
		} finally {
			this.nowDoing = [...this.nowDoing.slice(0, index), ...this.nowDoing.slice(index + 1)]
		}

	}
}

const longestAt = (values: string[][], index: number): number => values
	.map(arr => arr[index]?.length ?? 0)
	.reduce((a, b) => Math.max(a, b), 0)

const endPad = (str: string, maxLen: number): string => {
	while(str.length < maxLen){
		str += " "
	}
	return str
}

const formatMs = (ms: number): string => (ms / 1000).toFixed(2) + "s"