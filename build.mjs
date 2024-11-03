// this file should not be used as example of build script. it is weird in some ways

import * as esbuild from "esbuild"
import {promises as Fs} from "fs"
import * as Process from "process"

const defaultBuildOptions = {
	bundle: true,
	platform: "node",
	packages: "external",
	format: "esm",
	entryPoints: ["./src/main.ts"]
}

let buildUtils = await buildBuildUtilsForTheBuild()

let {clear, typecheck, build, publishToNpm, cutPackageJson, copyToTarget, generateDts, printStats} = buildUtils({
	defaultBuildOptions
})

main(Process.argv[2])

async function main(mode) {
	await clear()

	switch(mode ?? "build"){
		case "build": {
			await typecheck()
			await build({minify: false})
			// while this package is not expected to be used from TS (build scripts are usually in JS),
			// it's nice to have .d.ts anyway, for IDEs that can use them for autocomplete
			await generateDts()
			await copyToTarget("./LICENSE", "./README.md")
			await cutPackageJson()
			printStats()
		} break

		case "typecheck": {
			await typecheck()
		} break

		case "publish": {
			await main("build")
			await publishToNpm()
		} break
	}
}

// it would be a waste to not use this package while building this package
// therefore to build this package we need to build this package first
async function buildBuildUtilsForTheBuild(){
	await Fs.rm("./target", {recursive: true, force: true})

	await esbuild.build({
		...defaultBuildOptions,
		entryPoints: ["./src/main.ts"],
		outfile: "./target/ts-build-utils-for-self-build.mjs",
	})

	const {buildUtils} = await import("./target/ts-build-utils-for-self-build.mjs")
	return buildUtils
}