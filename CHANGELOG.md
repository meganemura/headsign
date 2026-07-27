# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
During 0.x, a minor bump means feature additions (which may include breaking
changes), and a patch bump means fixes only.

## [Unreleased]

### Changed

- **Breaking: `next` no longer reprints a cached verdict, and
  `max_attempts` now counts judgments.** Until now, a `next` on a working
  tree unchanged since that phase's last failure reprinted the old verdict
  for free — no gate run, no attempt counted. That free probe existed
  because `next` was once the only way to see where a run stood;
  `headsign status` (0.2.0) does that job now, read-only and as often as
  you like. So every `next` on a running phase runs that phase's gate, and
  every failure it reports spends one attempt: ask twice and your test
  suite runs twice. The rule that replaces "probing is free" is **did work
  → `next`; want to look → `status`**. One effect is deliberate: an agent
  that keeps calling `next` without doing any work now spends the phase's
  attempts, and once `max_attempts` runs out the run ends the way
  `on_exhausted` says — `ESCALATE`, by default — where before it consumed
  nothing and could be abandoned quietly. A `RETRY` line no longer carries the
  `(unchanged)` marker or its `[cached — …]` note, since neither can happen
  any more. See
  [ADR-0012](docs/adr/0012-removing-the-tree-hash-cache.md).
- **Breaking: `state.json`'s `last_eval` is now `last_failure`**, and has
  lost `tree_hash` (the cache's field) and `result` (always `"fail"`).
  What `status` prints as `--- last failure: … ---` is unchanged; that
  display is the field's only reader and the reason it still exists. A
  `state.json` written by 0.2.0 is not migrated — see Upgrading.
- **Breaking: `headsign claim` is now the only way a run learns who drives
  it.** `start` and `next` no longer record a driver, and the `Stop` hook
  no longer compares identifiers: while nobody has claimed a run it nudges
  whichever session stops in the run's directory, and once a delegated
  agent has claimed it, that agent's own turn ends are the only ones held.
  A session driving its own run needs no claim and keeps its backstop.
  What this gives up is telling two *sessions* apart in one directory: a
  second session watching a run it isn't driving is now nudged like any
  other, and should set `HEADSIGN_OBSERVER` to opt out. `status`'s
  `driver:` line has two readings to match — `a delegated agent`, or `not
  delegated yet — no agent has claimed this run`. See
  [ADR-0013](docs/adr/0013-claim-only-driver-identity.md).
- **Breaking: `HEADSIGN_SESSION_ID` is gone**, and headsign no longer reads
  a session identifier from the environment at all (`CLAUDE_CODE_SESSION_ID`
  included). `HEADSIGN_OBSERVER` is the only environment variable it now
  consults. Setting `HEADSIGN_SESSION_ID` was worse than useless under
  Claude Code: the CLI recorded the value you exported while the hook
  compared against the identifier Claude Code handed it on stdin, so the
  two disagreed permanently and the session that set it stopped being
  nudged at all.
- **Breaking: `state.json`'s `driver_session` and `driver_source` are
  replaced by a single `driver_agent`.** Only one thing can be recorded
  there now — the id of the delegated agent that claimed the run — so the
  field is named for it, and the companion field that used to say which
  mechanism had written it is gone. A `state.json` written by 0.2.0 is not
  migrated; an unfinished run reads as unclaimed. See Upgrading.
- headsign no longer runs `git`. The working-tree fingerprint was its only
  use of it, so the tool now behaves identically inside a repository,
  outside one, and in a linked worktree, and `/bin/sh -c` — running the
  check commands you wrote — is the only kind of process it spawns.

### Upgrading

Finish or abort a run before upgrading, or start it again afterwards: a
`state.json` from 0.2.0 carries `last_eval` and the two ownership fields
this version replaced, so an upgraded-into run loses its recorded driver
(it reads as unclaimed) as well as its last-failure block. If such a run
was being driven by a delegated agent, have that agent run `headsign
claim` again. Drop `HEADSIGN_SESSION_ID` from any shell profile or hook
config that exports it — nothing reads it any more. Workflow files are
unaffected: nothing in `workflow.yaml` changes, and the six answer tokens
are the same six. Do re-read your slowest gate, though — its cost is now
paid on every `next` rather than once per change to the working tree.

## [0.2.0] - 2026-07-27

Two themes: a workflow can now branch more than two ways, and a run can be
driven by a delegated agent rather than only by the session that started it.

### Added

- k-way routing on `on_pass`: a phase can branch to one of several phases
  instead of exactly one. Write `on_pass` as a list of `when:`/`to:` routes
  — the `when:` commands run in order once the gate has passed, the first to
  exit 0 decides the destination, and the last entry (which has no `when:`)
  is the default. `ADVANCE` gains a `--- routed: … ---` line naming the
  route taken, and `.headsign/log` records the same. A `when:` that cannot
  be run at all (spawn error, timeout) stops the run with exit 3 instead of
  falling through to the default: the thing being decided is the
  destination. A plain string `on_pass` behaves exactly as before, down to
  its output and log lines. See
  [ADR-0011](docs/adr/0011-k-way-routing-on-pass.md).
- `headsign status`: a strictly read-only command for a session that isn't
  driving a run — reports the current phase (or terminal outcome) without
  running any gate, writing state, or taking the lock. Its exit code never
  overlaps `next`'s: 0 whenever state is readable (including
  `ESCALATED`/`ABORTED`), 3 only when there's no run to read. Its `driver:`
  line reports only what it can establish: an environment-based match proves
  the caller is `this session, or an agent it delegated to` and cannot
  separate the two, and a run whose driver was seated by `headsign claim`
  reads `a delegated agent`.
- Driver ownership for repositories with more than one session open on
  them. `start`/`next` stamp who is driving (`driver_session`, resolved from
  `HEADSIGN_SESSION_ID`, or automatically from Claude Code's own session
  identifier), and a stop by a confirmed non-driver passes through instead
  of being nudged toward a run it isn't running. See
  [ADR-0008](docs/adr/0008-multi-session-ownership.md).
- `headsign claim`, for handing a run to a delegated agent — a teammate
  under Claude Code's agent-teams feature, or a subagent — whose own
  environment cannot tell it apart from the session that spawned it. It arms
  a one-shot marker that the claiming agent's own turn end seals, and the
  hook confirms the seal in its message. See
  [ADR-0009](docs/adr/0009-claim-handshake.md) and
  [ADR-0010](docs/adr/0010-subagent-stop-identity.md).
- A `SubagentStop` hook, giving a delegated agent the same backstop a
  session has always had: while a run is `running`, the agent recorded as
  its driver is pushed back to `headsign next` at the end of its own turn
  instead of stopping silently. Agents that aren't the driver pass through
  untouched, unless they are the first to name themselves under an armed
  `claim` marker — that is how a claim gets sealed. The plugin registers it
  automatically; the plugin-free `settings.json` snippet in the README now
  shows both hooks.
- `HEADSIGN_OBSERVER`: set on a session that should never be nudged by the
  stop-boundary hooks, regardless of driver ownership — the manual opt-out
  for environments where no session identifier resolves.
- Pause notes: writing one line to `.headsign/tmp/stop-note` lets a session
  stop immediately and quietly — the stop-boundary hook consumes the note,
  records a `paused` line in `.headsign/log`, and leaves the run resumable
  with `headsign next`. Silent exits now always leave a trace. A `stalled`
  line is recorded when the nudge cap is reached instead, so an unattended
  supervisor can tell an abandoned run (`status == "running"` plus `stalled`
  in the log) from a deliberate pause.
- Example workflows in `example.headsign/`, one per shape worth copying:
  role-based ones (TDD feature, bugfix, docs, release, and headsign's own
  development workflow), `triage.yaml` for a queue judged one item per run,
  `router.yaml` for a three-way branch, and `sweep.yaml` for a cycle that
  ends because the data ran out rather than because a counter tripped. Each
  is drawn as a flowchart in `example.headsign/README.md`. This repository
  dogfoods them through a `.headsign` symlink.

### Changed

- A phase unreachable from `entry` is now a **warning** rather than a
  validation error. `headsign validate` prints it to stderr and still exits
  0, `start` prints it once per run, and `next` stays silent so the
  every-turn path isn't noisy. Workflows that headsign previously refused to
  load for this reason now load and run — including a run wedged mid-flight
  by a half-written phase or a commented-out edge.
- The stop-boundary nudge cap was raised from 3 to 5 and is now purely an
  abnormal-case backstop; the pause note is the intended exit for deliberate
  stops.
- No-argument `headsign validate` now defaults to the current run's own
  `workflow_path` (from `.headsign/state.json`, whatever its status)
  whenever a run exists, falling back to the plain `.headsign/workflow.yaml`
  default only when there is no run; an explicit name or `--workflow` still
  always wins.
- Git worktrees are documented as supported within one clear boundary —
  **one worktree, one independent run**: a worktree's `state.json`, lock,
  and log live in that worktree's own `.headsign/`, headsign writes nothing
  under the shared `.git`, and sharing or coordinating state between
  worktrees remains out of scope.

### Upgrading

Nothing to do coming from 0.1.0: every 0.1.0 workflow file, and every
`state.json` a 0.1.0 run left behind, is read unchanged. If instead you have
been tracking `main` and live-patching an installed plugin, a run claimed
before the `SubagentStop` change carries a driver stamp neither hook now
matches — nothing misfires, but that run's stop backstop is off. Run
`headsign claim` again from the agent that should be driving, or start a
fresh run.

## [0.1.0] - 2026-07-25

### Added

- Deterministic phase gates: `workflow.yaml` choreographs phases whose gates
  are ordinary shell checks with `on_pass`/`on_fail` routing — the LLM never
  judges, only reads the verdict.
- A single question, `headsign next`, and its six answer tokens: `ADVANCE`,
  `RETRY`, `PENDING`, `COMPLETE`, `ESCALATE`, `ABORT`.
- Per-phase attempt counting with a tree-hash cache, so probing `next` on an
  unchanged working tree costs no attempt.
- `ready:` async gates: an unready gate answers `PENDING` with zero
  mutation — no attempt spent, no `clear:` run.
- `clear:` with a deletion announcement, and a `.headsign/tmp/` scratch area
  for phase-local files.
- A self-healing lock so concurrent `next` invocations don't corrupt state.
- A run transition log at `.headsign/log`.
- The Claude Code plugin: the `workflow` skill plus a walk-up Stop hook
  backstop that fails open after three nudges.
- `headsign start <name>` for selecting among multiple workflow files.
- `-h` / `--help` on the CLI.
