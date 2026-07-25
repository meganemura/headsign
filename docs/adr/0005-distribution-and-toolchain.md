# ADR-0005: Distribution and toolchain — single-file bundle, minimal dependencies

- Status: accepted
- Date: 2026-07-23

## Context

The Stop hook runs the CLI on effectively every session stop, and plugin
users must not need a build step or `npm install`. Startup cost and install
friction are therefore design constraints, not nice-to-haves.

## Decision

- **TypeScript**, bundled by **esbuild** (with the yaml parser inlined) into
  a single `plugin/dist/headsign.mjs`, executed as `node dist/headsign.mjs`.
  No on-the-fly transpilers (ts-node etc.) anywhere in the runtime path —
  the hook fires constantly and must start fast.
- **The bundle is committed.** Plugins install straight from git; users get
  a working CLI with zero build. The bundle is regenerated and committed
  whenever `src/` changes (checked in review).
- **Runtime dependency policy: `yaml` and nothing else.** No CLI framework
  (commander etc.) — there are six commands and at most one flag; parsing
  by hand is ~20 lines. Dev dependencies: `typescript`, `esbuild`,
  `@types/node` only.
- **Tests use `node:test`** on Node's native TypeScript type-stripping
  (Node ≥ 22.6; this repo develops on ≥ 25). Zero test-framework
  dependencies. Adding any new dependency, runtime or dev, requires an
  explicit decision recorded against this ADR.
- **POSIX only for v1.** Checks run via `/bin/sh -c`. Windows support is
  not attempted until someone needs it.
- `package.json` exposes `bin: { "headsign": "plugin/dist/headsign.mjs" }`
  so the same artifact serves a future npm install path (`npm view
  headsign` confirmed the name unclaimed on 2026-07-23).

## Consequences

- One artifact, three consumption modes: plugin hook, plugin-provided CLI
  (`node ${CLAUDE_PLUGIN_ROOT}/dist/headsign.mjs`), future npm bin.
- Committed dist means occasional noisy diffs; accepted in exchange for
  zero-build installs.
