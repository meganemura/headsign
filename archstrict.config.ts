import type { Config } from "./archstrict.types.js";

// Public surface: other modules may import a directory module only through
// its own surface file (named by `surface` below), or through the files its own
// package.json exports map names. An import that reaches any other file in
// the directory is a violation. A directory module with no such file is
// entirely private. A module whose glob names one file is that file, so its
// entry names the file itself as its surface.
export default {
  schemaVersion: 1,
  surface: ["index.ts", "index.tsx", "index.mts", "index.cts"],
  // Kept out of analysis entirely:
  // - archstrict's own two files, which are never module content;
  // - hidden directories at any depth (.git, tool state), which tsc's own
  //   default include also skips;
  // - common noise directories that init found on disk (tests).
  //   Remove one of these entries if that directory holds module content.
  // - colocated test files, found on disk (*.test.ts).
  //   A test file imports across modules as a fixture; boundary rules read production code.
  //   Remove both matching entries below (root and nested form) if that file must stay analyzed.
  exclude: [
    "archstrict.config.ts",
    "archstrict.types.ts",
    ".*/**",
    "**/.*/**",
    "tests/**",
    "*.test.ts",
    "**/*.test.ts",
  ],
  // src/ is the library. The tag is independent of the module list below:
  // each flat file under src/ is its own module, and every one of those files
  // carries kind:lib.
  classify: [{ glob: "src/**", tags: ["kind:lib"] }],
  // init declared one module per directory that holds TypeScript source and
  // one per TypeScript source file, so every file that check analyzes
  // belongs to exactly one module. Merge, rename, or remove entries freely:
  // init never rewrites this file. After an edit, run archstrict init to
  // regenerate archstrict.types.ts.
  declaredModules: [
    // Each directory and TypeScript source file directly in src/.
    { name: "antigravityhook.ts", glob: "src/antigravityhook.ts", surface: "antigravityhook.ts" },
    { name: "cli.ts", glob: "src/cli.ts", surface: "cli.ts" },
    { name: "engine.ts", glob: "src/engine.ts", surface: "engine.ts" },
    { name: "gate.ts", glob: "src/gate.ts", surface: "gate.ts" },
    { name: "optimization.ts", glob: "src/optimization.ts", surface: "optimization.ts" },
    { name: "render.ts", glob: "src/render.ts", surface: "render.ts" },
    { name: "runfinder.ts", glob: "src/runfinder.ts", surface: "runfinder.ts" },
    { name: "sessionhook.ts", glob: "src/sessionhook.ts", surface: "sessionhook.ts" },
    { name: "state.ts", glob: "src/state.ts", surface: "state.ts" },
    { name: "stophook.ts", glob: "src/stophook.ts", surface: "stophook.ts" },
    { name: "workflow.ts", glob: "src/workflow.ts", surface: "workflow.ts" },
    // Each other top-level directory that holds TypeScript source, and each top-level TypeScript source file.
    { name: "plugin", glob: "plugin/**" },
  ],
  because: "archstrict init: one module per directory that holds TypeScript source and per TypeScript source file, so the first check covers every file it analyzes. src/ is flat, so each file is its own module, and those files carry kind:lib",
} satisfies Config;
