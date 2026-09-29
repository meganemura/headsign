import type { Config } from "./archstrict.types.js";

// Seams follow how headsign grows, not the init walk that named one module
// per file and then stopped. A new verb lands in engine.ts, a new check kind
// in gate.ts, a schema change in workflow.ts, an assessment change in
// optimization.ts, and a new command's argv in cli.ts. Those stay separate
// modules: cli.ts, engine.ts, and render.ts already change together, and
// merging them would make every one of those changes a single module.
//
// Host adapters stay separate modules too. engine.ts may import stophook.ts
// for the one env reader ADR-0027 and ADR-0041 put there, and must not grow
// a dependency on sessionhook.ts or antigravityhook.ts. A new host is a new
// file, wired from cli.ts.
export default {
  schemaVersion: 1,
  surface: ["index.ts", "index.tsx", "index.mts", "index.cts"],
  // Tests import across seams as fixtures. The bundle and the example
  // consumer tree are not source. The overlay's tests are a second kit
  // (claude plugin test), not part of the overlay module.
  exclude: [
    "archstrict.config.ts",
    "archstrict.types.ts",
    ".*/**",
    "**/.*/**",
    "tests/**",
    "*.test.ts",
    "**/*.test.ts",
    "plugin/tests/**",
    "plugin/dist/**",
    "example.headsign/**",
  ],
  // Most-specific glob wins, so each seam file lists every tag it carries.
  // src/** is the fallback for a file that does not have a seam yet: still
  // a library, still closed to the YAML parser and to spawning.
  classify: [
    { glob: "src/state.ts", tags: ["kind:lib", "seam:state", "loader:closed", "spawn:closed"] },
    { glob: "src/workflow.ts", tags: ["kind:lib", "seam:workflow", "loader:yaml", "spawn:closed"] },
    { glob: "src/gate.ts", tags: ["kind:lib", "seam:gate", "loader:closed", "spawn:gate"] },
    { glob: "src/optimization.ts", tags: ["kind:lib", "seam:optimization", "loader:closed", "spawn:closed"] },
    { glob: "src/runfinder.ts", tags: ["kind:lib", "seam:runfinder", "loader:closed", "spawn:closed"] },
    { glob: "src/render.ts", tags: ["kind:lib", "seam:render", "loader:closed", "spawn:closed"] },
    { glob: "src/engine.ts", tags: ["kind:lib", "seam:engine", "loader:closed", "spawn:closed"] },
    { glob: "src/stophook.ts", tags: ["kind:lib", "seam:stophook", "loader:closed", "spawn:closed"] },
    { glob: "src/sessionhook.ts", tags: ["kind:lib", "seam:sessionhook", "loader:closed", "spawn:closed"] },
    { glob: "src/antigravityhook.ts", tags: ["kind:lib", "seam:antigravityhook", "loader:closed", "spawn:closed"] },
    { glob: "src/cli.ts", tags: ["kind:app", "seam:cli", "loader:closed", "spawn:closed"] },
    { glob: "src/**", tags: ["kind:lib", "loader:closed", "spawn:closed"] },
    { glob: "plugin/hooks/**", tags: ["seam:overlay", "loader:closed", "spawn:closed"] },
  ],
  declaredModules: [
    { name: "state", glob: "src/state.ts", surface: "state.ts" },
    { name: "workflow", glob: "src/workflow.ts", surface: "workflow.ts" },
    { name: "gate", glob: "src/gate.ts", surface: "gate.ts" },
    { name: "optimization", glob: "src/optimization.ts", surface: "optimization.ts" },
    { name: "runfinder", glob: "src/runfinder.ts", surface: "runfinder.ts" },
    { name: "render", glob: "src/render.ts", surface: "render.ts" },
    { name: "engine", glob: "src/engine.ts", surface: "engine.ts" },
    { name: "stophook", glob: "src/stophook.ts", surface: "stophook.ts" },
    { name: "sessionhook", glob: "src/sessionhook.ts", surface: "sessionhook.ts" },
    { name: "antigravityhook", glob: "src/antigravityhook.ts", surface: "antigravityhook.ts" },
    { name: "cli", glob: "src/cli.ts", surface: "cli.ts" },
    // Private on purpose: Claude loads plugin/hooks/mod.ts by manifest path.
    // Nothing in src/ may import it, so it has no surface file to bypass.
    { name: "overlay", glob: "plugin/hooks/**" },
  ],
  edges: {
    allowDeny: [
      {
        source: "seam:gate",
        targetNamespace: "seam",
        allow: ["workflow"],
        because: "a gate runs checks and when: probes against the workflow document. It does not read the run record, word an outcome, or choose a route",
      },
      {
        source: "seam:optimization",
        targetNamespace: "seam",
        allow: ["state"],
        because: "assessment records hang off the run record. They do not load workflow YAML, run a gate, or call a verb",
      },
      {
        source: "seam:runfinder",
        targetNamespace: "seam",
        allow: ["state"],
        because: "finding a run asks where the record file is. It does not load a workflow, run a hook, or take a lap",
      },
      {
        source: "seam:render",
        targetNamespace: "seam",
        allow: ["state", "engine"],
        because: "wording reads the record and the outcome types the verb already returns. It does not load YAML, spawn a check, or decide a route",
      },
      {
        source: "seam:engine",
        targetNamespace: "seam",
        allow: ["state", "workflow", "gate", "render", "optimization", "stophook"],
        because: "a verb may use the record, the loaded workflow, the gate, wording, and optimization. The one host it may name is stophook, for the env readers ADR-0027 and ADR-0041 keep there so the stamp and the stop comparison stay one source. A new verb must not import sessionhook or antigravityhook",
      },
      {
        source: "seam:stophook",
        targetNamespace: "seam",
        allow: ["state", "render", "runfinder", "optimization"],
        because: "a stop hook reads the record, finds a run, words a log line, and looks at an assessment. It does not load workflow YAML, spawn a gate, or call a verb",
      },
      {
        source: "seam:sessionhook",
        targetNamespace: "seam",
        allow: ["state", "runfinder"],
        because: "session discovery reads an existing record and is read-only. It does not run a gate, word a contract, or take a lap",
      },
      {
        source: "seam:antigravityhook",
        targetNamespace: "seam",
        allow: ["stophook", "sessionhook"],
        because: "the Antigravity adapter translates that host's payloads into the stop and session hooks. It does not grow its own record, gate, or verb",
      },
      {
        source: "seam:cli",
        targetNamespace: "seam",
        allow: ["state", "workflow", "engine", "render", "stophook", "sessionhook", "antigravityhook"],
        because: "the CLI is the composition root: argv, the clock, printing, and exit codes. validate loads a workflow file here (ADR-0018); it does not spawn a gate or own an assessment",
      },
      {
        source: "loader:closed",
        targetNamespace: "pkg",
        deny: ["yaml"],
        because: "workflow.ts is the only seam that parses workflow YAML. A verb, a gate, a host, or the CLI consumes the loaded document",
      },
      {
        source: "spawn:closed",
        targetNamespace: "pkg",
        deny: ["child_process"],
        because: "gate.ts is the only seam that spawns a check, a ready: probe, or an on_pass when:. A verb asks the gate for a verdict",
      },
    ],
    order: [
      {
        tagNamespace: "kind",
        sequence: { "": ["lib", "app"] },
        direction: "downward-only",
        because: "library seams must not import the CLI. A new command is wired in cli.ts, which already calls the verb, and does not spread downward into the record, the gate, or a host",
      },
    ],
    point: [
      {
        from: "src/state.ts",
        to: "src/**",
        because: "the run record is a leaf. Workflow loading, verbs, gates, hosts, and the CLI depend on it, and it depends on none of them",
      },
      {
        from: "src/workflow.ts",
        to: "src/**",
        because: "workflow loading is a leaf. It owns the schema and the fingerprint, and it does not read state.json, run a gate, or call a verb",
      },
      {
        from: "src/**",
        to: "plugin/**",
        because: "the library and the CLI do not import the overlay. The pane is a host-specific file, not a seam the verbs grow into. The reverse edge is not a rule yet: plugin/hooks/mod.ts's only import is the host package claude-code, unresolved in this repo, so a from-plugin rule matches no edge and cannot be installed until that import resolves or the file gains another one",
      },
    ],
  },
  deprecated: [
    {
      from: "engine",
      to: "stophook",
      count: 1,
      because: "one import, for resolveDriveSession, resolveDriveAgent, and isObserver. ADR-0027 and ADR-0041 keep those readers in stophook.ts so the stamp and the hook agree. A second import would mean a verb started depending on hook decisions; move that read to the CLI instead of growing this edge",
    },
  ],
  // Every seam is clean. A new violation stays visible; todo will not freeze it.
  strict: [
    "state",
    "workflow",
    "gate",
    "optimization",
    "runfinder",
    "render",
    "engine",
    "stophook",
    "sessionhook",
    "antigravityhook",
    "cli",
    "overlay",
  ],
  mustBeEmpty: [
    {
      glob: "src/*/**",
      because: "src/ stays one file per seam. A subdirectory would collect the next verb, gate, and loader into a directory no seam named. Removing this guard is the same change that declares the new module",
    },
    {
      glob: "src/index.ts",
      because: "a barrel at src/index.ts would make every seam one import path, so a change to any of them thrashes every importer",
    },
  ],
  because: "Seams match growth measured in git history and archstrict hotspots at 01aafd3: state.ts is the high fan-in leaf (score 224), and cli/engine/render are the co-change boundary (26–33 commits) that must stay three modules. Workflow loading and the gate stay leaves that own yaml and child_process. Optimization stays a record-only seam. Hosts stay out of the verb except the one stophook import ADR-0027 and ADR-0041 require, frozen at one edge. The overlay stays a private Claude-only module. Future bet: if a wording-only change stops riding along with verbs (engine↔render co-change share falls below half), extract the outcome types into their own leaf then. Until that happens, merging cli, engine, and render would only make the hotspot one module.",
} satisfies Config;
