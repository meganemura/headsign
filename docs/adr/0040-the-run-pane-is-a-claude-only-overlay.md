# ADR-0040: The run pane is a Claude-only overlay on the shared plugin

- Status: accepted
- Date: 2026-09-15
- Amends [ADR-0028](0028-codex-as-a-second-principal.md): the shared plugin
  tree gains a part that one host loads and the other does not see.
- Relates to [ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md):
  the pane reads `status` under that contract and nothing more.
- Relates to [ADR-0039](0039-design-for-the-model-that-improves-the-method.md):
  this is an explicit future bet, stated in its four fields below.

## Context

Claude Code is adding a fifth hook kind. A plugin's hooks file may name a
TypeScript module, and that module registers functions on the engine's events
with `register(on)`. Each function receives `($, e, next)`: `$` is the only
door to side effects, `e` is the event, and `next` runs the rest of the chain.
The product name is "Claude Mods"; the engineering term is "function hooks".
As of 2026-09-15 the feature loads only where a session sets
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and its API may change between
releases without notice. The public documentation for hooks does not describe
it yet. The nearest things to a specification are the declarations that the
`/plugin-types` command writes, the built-in mods published as source in the
Claude Code repository, and the architecture document attached to the public
proposal.

One thing a function hook can do that a command hook cannot is draw. A module
may open a pane beside the transcript and render into it, and the engine
redraws it without a model turn. headsign's run state has so far been
readable only by running `headsign status` in a shell, or through a separate
viewer process.

Two facts constrain where such a module can live.

1. **Codex reads the same `hooks/hooks.json`** ([ADR-0028](0028-codex-as-a-second-principal.md)).
   Function hooks are a Claude Code feature. Whether Codex tolerates an
   unknown `modules` key in that file was not measured, and a loader that
   drops the file would silence the stop hooks with no message.
2. **A managed Claude Code withholds `classic.*` from user plugins.** The
   built-in `sec-default` mod, seated outermost on a machine with managed
   settings or for a Team or Enterprise organization, continues every
   `classic.*` event past the user tier. A user-tier module that re-implemented
   the Stop backstop as a function hook would not run there. `tool.call` and
   `turn.complete` pass through.

Two measurements informed the placement. Claude Code 2.1.250, obtained from
npm, still runs a plugin's classic hooks when `hooks.json` also carries a
`modules` key or an arbitrary unknown top-level key. Claude Code 2.1.271 loads
a second hooks file named by the manifest's `hooks` array beside the default
one, and the classic hooks in the default file still fire.

## Decision

1. **The pane is a function-hooks module in the shared plugin, named only by
   the Claude manifest.** `plugin/.claude-plugin/plugin.json` lists
   `hooks: ["./hooks/hooks.json", "./hooks/mods.json"]`. `hooks/hooks.json`
   is unchanged and stays the file Codex reads. `hooks/mods.json` holds only
   the `modules` entry. A Claude Code without function hooks enabled, and
   Codex, load the command hooks and nothing else.
2. **The stop hooks and the session-start hook stay command hooks.** They are
   the backstop, they must run on both hosts, and they must run on a managed
   Claude Code. The module never hooks `classic.*`.
3. **The module reads the run through the CLI, under ADR-0030.** It runs
   `headsign status` in the run's directory, colors the first line by its
   token, treats exit 3 as "nothing to report", and draws every other line as
   text. It never opens `state.json`, never parses a line past the first, and
   never runs `next`, `abort`, or `claim`.
4. **`/headsign` is the command.** Registered command names are not
   namespaced by plugin: a command named `status` would shadow the built-in
   `/status`, and `/headsign:status` does not exist. The command toggles the
   pane and answers with one line for the transcript.
5. **Refresh is event-driven and coalesced.** The pane refreshes after a Bash
   tool call whose command names `headsign`, whichever agent loop ran it, and
   after `turn.complete`, which fires after the stop hooks. A `headsign start`
   opens the pane. The render hook never spawns a process; it draws the last
   report.
6. **The module is typed against generated declarations that stay out of the
   tree.** `/plugin-types` writes them to `.claude/types/`, which is ignored.
   `plugin/hooks/tsconfig.json` checks the module; the repository's default
   typecheck does not include it, because the module's environment is not
   Node's.

## The future bet

- **Assumed change.** Function hooks ship enabled by default within months,
  and the events and nouns the module uses (`session.start`, `command.run`,
  `ui.render` of `Pane`, `ui.close`, `tool.call`, `turn.complete`,
  `$.process.run`, `$.fs.exists`, `$.session.cwd`, `$.ui.open`) keep their
  shape.
- **Expected value.** A person driving or watching a run sees its phase, the
  last stop, and the phase instructions beside the transcript, at no token
  cost and without a second process. Later modules can use the same seat for
  what command hooks cannot express.
- **Uncertainty.** The API is early access. A rename breaks the module
  silently: the engine skips a hook that throws or returns the wrong shape and
  logs it only to the debug file. The validator's static rules are
  undocumented; one of them (only top-level function declarations may receive
  `$`) shapes how the module is written.
- **Reason to reconsider.** If the feature ships with a different manifest
  arrangement, or if a release changes `Pane`'s props or `tool.call`'s
  envelope, regenerate the declarations, re-run the typecheck, and revise or
  withdraw the module. If Codex gains an equivalent surface, revisit whether
  the pane belongs to one host.

## Consequences

- The plugin gains one `.ts` file that Claude Code compiles itself; no build
  step and no new dependency.
- The plugin manifest now names its hook files explicitly. Anyone adding a
  third file adds it to that list.
- `docs/architecture.md` lists the module beside the hooks and states the
  boundary the module keeps.
- ADR-0028's description of the shared tree gains one exception: a file the
  Codex host does not read. Its session-attribution boundary is unchanged.
- Verifying the pane needs a real terminal session with the flag set; the
  test suite does not cover the drawing. A test kit for hooks modules exists
  (`claude plugin test`) and is a separate piece of work.
