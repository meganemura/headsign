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
- **The hook registration checks for its interpreter before it spawns one**
  (added 2026-08-17). `plugin/hooks/hooks.json` registers each stop-boundary
  hook in Claude Code's *shell* form, guarded:

  ```
  command -v node >/dev/null 2>&1 && exec node "${CLAUDE_PLUGIN_ROOT}/dist/headsign.mjs" stop-hook || exit 0
  ```

  Installing the plugin registers these hooks in every session, including
  sessions in repositories that never heard of headsign. `node` is the one
  thing the bundle needs and cannot bring, and a hook process that fails to
  spawn is a non-blocking error that still prints a `Stop hook error` notice
  at *every* turn end — on a machine where Claude Code was installed natively,
  or where node is a version-manager shim that only an interactive shell sets
  up, that notice is all the user would ever see of headsign. The guard turns
  that case into silence, which is the direction
  [ADR-0006](0006-stop-hook-backstop.md) step 7 already fails in.

  Three properties are what any rewrite of these two strings has to keep, and
  what `tests/acceptance.test.ts`'s "--- the hook registration ---" section
  pins by reading the strings out of `hooks.json` and running them:

  1. No interpreter → exit 0, no stdout, no stderr.
  2. An interpreter → stdin reaches the CLI unread, and its exit 2 plus stderr
     reach Claude Code unchanged. **`exec` is what carries them**: written as
     `… && node … || exit 0`, a blocking exit 2 would fall into the `||` and
     come back as 0, disarming the backstop on every machine that *does* have
     node — the failure the guard is supposed to prevent, inverted and silent.
  3. `"${CLAUDE_PLUGIN_ROOT}"` stays quoted; a plugin cache path may contain
     spaces.

  This costs one `sh -c` per stop, which the POSIX-only rule above already
  spends on every gate. Exec form (`args`) cannot express a condition, and a
  shipped wrapper script would break this ADR's single-artifact rule, so
  neither was taken.

## Consequences

- One artifact, three consumption modes: plugin hook, plugin-provided CLI
  (`node ${CLAUDE_PLUGIN_ROOT}/dist/headsign.mjs`), future npm bin.
- Committed dist means occasional noisy diffs; accepted in exchange for
  zero-build installs.
- A machine with no reachable `node` gets no backstop and no warning that it
  has none. The run still works — the agent's own `headsign next` calls are
  the primary path, and the hook was always the insurance
  ([ADR-0006](0006-stop-hook-backstop.md)) — but nothing announces the
  insurance is gone. Announcing it means a non-zero exit, and a non-zero exit
  is a notice at every turn end, which is the noise the guard removes.
- The same guard shape — resolving `headsign`, and then its interpreter — is
  what `docs/workflow-reference.md` gives the reader who registers the backstop
  by hand. That recipe passed `npx headsign stop-hook` until this decision,
  which reaches for the network when the package is absent. It takes one clause
  more than the plugin's, because there **finding the CLI does not establish
  that it can run**: npm links `node_modules/.bin/headsign` to the bundle, whose
  build banner is `#!/usr/bin/env node`, so on the machine this whole decision
  is about the file is present and executable and `exec` still exits 127 with
  `env: node: No such file or directory` (measured 2026-08-17, `npm install -D`
  into an empty project, PATH `/usr/bin:/bin`). The plugin's registration names
  its interpreter itself, so one check covers both there.
