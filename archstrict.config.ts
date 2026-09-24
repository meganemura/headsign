import type { Config } from "./archstrict.types.js";

export default {
  schemaVersion: 1,
  surface: "index.ts",
  exclude: [
    "*.ts",
    "test/**",
    "tests/**",
    "example/**",
    "example.headsign/**",
    "spike/**",
    "dist/**",
    "coverage/**",
    "scripts/**",
    "features/**",
    "fixtures/**",
    "plugin/**",
  ],
  classify: [{ glob: "src/**", tags: ["kind:lib"] }],
  // First operational adopt: one module for the whole library surface.
  // headsign src/ is flat (no subdirs); refining later needs safe single-file modules.
  declaredModules: [
    { name: "headsign", glob: "src/**", surface: "index.ts" },
  ],
  because: "headsign first adopt: single src module; exclude tests/plugin/example",
} satisfies Config;
