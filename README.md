# ts-build-utils
A collection of utility scripts that help with build process of TypeScript projects.  
Powered by [ESBuild](https://www.npmjs.com/package/esbuild), [@chialab/esbuild-html-plugin](https://www.npmjs.com/package/@chialab/esbuild-plugin-html), [dts-bundle-generator](https://www.npmjs.com/package/dts-bundle-generator) and more.  

## Install 

```bash
npm install --save-dev @nartallax/ts-build-utils
```

## Use

```js
// Main entrypoint of this package is buildUtils function:
import {buildUtils} from "@nartallax/ts-build-utils"

// This function accepts parameters describing your project and creates a bunch of other functions (not everything listed here):
const {clear, build, runTests, copyToTarget, publishToNpm, serve} = buildUtils({
  buildOptions: {
    entryPoints: ["./src/index.html"]
  }
})

// buildUtils() assumes a lot of stuff, like that project has tsconfig.json, and that tsconfig.json has rootDir set;
// this may not always be true, but that's checked, so if something is not there - the script will tell you.
// also override options are there for almost everything; if you

// after acquiring the utils, you may use them to describe your build process:
await clear()
switch(process.argv[2]){
  case "dev": {
    await serve()
  } break

  case "test": {
    await runTests({nameFilter: process.argv[3]})
  } break

  case "publish": {
    await build()
    await copyToTarget("README.md", "LICENSE")
    await publishToNpm({dryRun: true})
  }
}
```


