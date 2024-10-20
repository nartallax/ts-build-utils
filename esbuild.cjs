// this file should not be used as example of build script. it is weird in some ways

void (async () => { // for top-level await

const esbuild = require("esbuild")
const {promises: Fs} = require("fs")
const Process = require("process")

const defaultBuildOptions = {
	bundle: true,
	platform: "node",
	packages: "external",
	format: "esm",
	entryPoints: ["./src/main.ts"]
}

let buildUtils = await buildBuildUtilsForTheBuild()

let {clear, typecheck, build, publishToNpm, cutPackageJson, copyToTarget, generateDts, watch} = buildUtils({
	defaultBuildOptions
})

main(Process.argv[2])

async function main(mode) {
	await clear()

	switch(mode ?? "release"){
		case "release": {
			await typecheck()
			await build({minify: true})
			// while this package is not expected to be used from TS (build scripts are usually in JS),
			// it's nice to have .d.ts anyway, for IDEs that can use them for autocomplete
			await generateDts()
			await copyToTarget("./LICENSE", "./README.md")
			await cutPackageJson()
		} break

		case "typecheck": {
			await typecheck()
		} break


		case "publish": {
			await main("release")
			await publishToNpm()
		}
	}
}

// it would be a waste to not use this package while building this package
// therefore to build this package we need to build this package first
async function buildBuildUtilsForTheBuild(){
	await Fs.rm("./target", {recursive: true, force: true})

	await esbuild.build({
		...defaultBuildOptions,
		entryPoints: ["./src/main.ts"],
		outfile: "./target/ts-build-utils-for-self-build.cjs",
		format: "cjs"
	})

	const {buildUtils} = require("./target/ts-build-utils-for-self-build.cjs")
	return buildUtils
}

})();