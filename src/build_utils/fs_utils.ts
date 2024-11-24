import * as Path from "path"
import {promises as Fs} from "fs"

export type SymlinkOptions = {
	from: string
	to: string
}

export const symlink = ({from, to}: SymlinkOptions) => Fs.symlink(Path.resolve(from), Path.resolve(to))

const isFsObjectExists = async(path: string, type: "file" | "directory" | "symlink") => {
	let stat: Awaited<ReturnType<typeof Fs.stat>>
	try {
		stat = await(type === "symlink" ? Fs.lstat : Fs.stat)(path)
	} catch(e){
		if((e as any).code === "ENOENT"){
			return false
		}
		throw e
	}

	let isRightType: boolean
	switch(type){
		case "file": isRightType = stat.isFile(); break
		case "directory": isRightType = stat.isDirectory(); break
		case "symlink": isRightType = stat.isSymbolicLink(); break
	}

	if(!isRightType){
		throw new Error(`Expected ${path} to be a ${type}, but it's not.`)
	}

	return true
}

export const isFileExists = (path: string) => isFsObjectExists(path, "file")
export const isDirectoryExists = (path: string) => isFsObjectExists(path, "directory")
export const isSymlinkExists = (path: string) => isFsObjectExists(path, "symlink")