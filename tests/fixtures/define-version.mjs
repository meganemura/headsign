// What esbuild's `--define:HEADSIGN_VERSION=...` does at build time, done at load time instead.
//
// src/cli.ts declares HEADSIGN_VERSION with no runtime binding, because the value is
// substituted into the bundle by `npm run build`. Running src/ directly therefore always takes
// the refusal branch, and the branch that PRINTS a version cannot be reached from src at all —
// tests/acceptance.test.ts covers it, but only through a built artifact. Preloading this file
// supplies the same binding the build supplies, so the printing branch can be exercised against
// the source the refusal branch is already exercised against, and the two stay one test file
// apart instead of one build step apart.
globalThis.HEADSIGN_VERSION = process.env["HEADSIGN_TEST_VERSION"] ?? "";
