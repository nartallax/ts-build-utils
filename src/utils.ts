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