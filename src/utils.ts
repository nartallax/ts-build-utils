import * as Fs from "fs"

export const omit = <T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> => {
	const result: any = {}
	const keySet = new Set(keys)
	for(const [k, v] of Object.entries(value)){
		if(!keySet.has(k as K)){
			result[k] = v
		}
	}
	return result
}

export const oneAtATime = (doWork: () => Promise<void>): () => Promise<void> => {
	let isWorking = false
	let isWorkQueued = false

	const tryDoWork = async() => {
		if(isWorking){
			isWorkQueued = true
			return
		}

		isWorking = true
		try {
			await doWork()
		} finally {
			isWorking = false
			if(isWorkQueued){
				isWorkQueued = false
				void tryDoWork()
			}
		}
	}

	return tryDoWork
}

export const getFileSizeStr = async(path: string): Promise<string> => {
	let stat: Fs.Stats
	try {
		stat = await Fs.promises.stat(path)
	} catch(e){
		void e
		return "-"
	}
	const level = Math.floor(Math.log2(stat.size) / 10)
	const name = ["b", "kb", "mb", "gb", "tb", "pb", "what goes after petabyte? uhhh."][level]
	const size = stat.size / (2 ** (level * 10))
	return `${level === 0 ? size : size.toFixed(2)}${name}`
}