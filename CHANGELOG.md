# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
During 0.x, a minor bump means feature additions (which may include breaking
changes), and a patch bump means fixes only.

## [Unreleased]

### Added

- Pause notes: writing one line to `.headsign/tmp/stop-note` lets a session
  stop immediately and quietly — the stop-boundary hook consumes the note, records a
  `paused` line in `.headsign/log`, and leaves the run resumable with
  `headsign next`. Silent exits now always leave a trace.
- A `stalled` line in `.headsign/log` when the nudge cap is
  reached, so unattended supervisors can detect an abandoned run
  (`status == "running"` plus `stalled` in the log).
- Role-based example workflows in `example.headsign/` (TDD feature, bugfix,
  docs, release, and headsign's own development workflow); this repository
  dogfoods them through a `.headsign` symlink.
- Multi-session driver ownership: `headsign start`/`next` stamp which
  session is driving a run (`driver_session`, resolved from
  `HEADSIGN_SESSION_ID` or, automatically under Claude Code,
  `CLAUDE_CODE_SESSION_ID`), and the Stop hook now recognizes a confirmed
  non-driver session's stop and passes it through instead of nudging it.
- `headsign status`: a new, strictly read-only command for a session that
  isn't driving a run — reports the current phase (or terminal outcome)
  without running any gate, writing state, or taking the lock. Its exit
  code never overlaps `next`'s: 0 whenever state is readable (including
  `ESCALATED`/`ABORTED`), 3 only when there's no run to read.
- `HEADSIGN_OBSERVER`: set on a session that should never be nudged by the
  stop-boundary hooks, regardless of driver ownership — the manual opt-out
  for environments where no session identifier resolves.
- `headsign claim`: arms a one-shot marker that the claiming agent's own
  turn end seals — headsign records that agent as the run's driver and
  confirms it in the hook's message — the reliable way to hand a run to a
  delegated agent (a teammate under Claude Code's agent-teams feature, or a
  subagent), whose own environment cannot tell it apart from the session
  that spawned it. See [ADR-0009](docs/adr/0009-claim-handshake.md) and
  [ADR-0010](docs/adr/0010-subagent-stop-identity.md).
- A `SubagentStop` hook, giving a delegated agent the same backstop a
  session has always had: while a run is `running`, the agent recorded as
  its driver is pushed back to `headsign next` at the end of its own turn
  instead of stopping silently. Agents that aren't the driver pass through
  untouched, unless they are the first to name themselves under an armed
  `claim` marker — that is how a claim gets sealed. The plugin registers it
  automatically; the plugin-free `settings.json` snippet in the README now
  shows both hooks.
- A triage example workflow (`example.headsign/triage.yaml`): headsign's own
  feedback-intake loop, which judges exactly one ticket per run. It doubles
  as a worked example of two patterns — a run-local completion marker as the
  `ready:` condition (a `next` issued before the judging is finished answers
  `PENDING` instead of spending an attempt) and `on_fail: "$end"` as the
  clean ending for a run that turns out to have no work to do (a reject, a
  defer, or an empty inbox).

### Changed

- The nudge cap (shared by both stop-boundary hooks) is now purely an
  abnormal-case backstop and was raised from 3 to 5; the pause note is the
  intended exit for deliberate stops.
- The `Stop` hook's decision order now checks observer opt-out and driver
  ownership before the exit-note gate, so a bystander's stop can no longer
  consume the shared nudge-cap insurance or a driver's pause note — see
  [ADR-0008](docs/adr/0008-multi-session-ownership.md).
- `headsign status`'s `driver:` line now shows `a delegated agent` (instead
  of guessing this-session/another-session) once a run's driver was seated
  via `headsign claim` — what's stored then isn't a session identifier at
  all, and the CLI has no reliable way to tell whether that agent is the
  caller, so it reports the fact it does know instead.
- `headsign status`'s `driver:` line now states exactly what an
  environment-based match establishes and no more: it reads `this session,
  or an agent it delegated to` where it used to read `this session`. A
  delegated agent resolves the identifier of the session that spawned it,
  so the comparison cannot separate the two. A delegated agent that wants
  certainty can end a turn instead: an ordinary nudge back to `headsign
  next` proves ownership, since `SubagentStop` sends one only on a positive
  match (a `Claim confirmed` reply is a different thing — the adoption gate
  seats whoever names itself first under an armed marker). Ending quietly
  proves nothing: never having claimed, an exhausted nudge cap, a consumed
  pause note, and `HEADSIGN_OBSERVER` all end turns quietly too. See
  [ADR-0010](docs/adr/0010-subagent-stop-identity.md).
- No-argument `headsign validate` now defaults to the current run's own
  `workflow_path` (from `.headsign/state.json`, whatever its status)
  whenever a run exists, falling back to the plain `.headsign/workflow.yaml`
  default only when there is no run; an explicit name or `--workflow`
  still always wins.
- Git worktrees are now documented as supported within one clear boundary —
  **one worktree, one independent run**: a worktree's `state.json`, lock,
  and log live in that worktree's own `.headsign/`, headsign writes nothing
  under the shared `.git`, and sharing or coordinating state between
  worktrees remains out of scope.
- `docs/maintenance.md` gained a "Feedback triage loop" section: the
  `headsign.feedbackDir` prerequisite, one ticket per run and why batching
  defeats the point, and the rule that nothing identifying a feedback source
  may enter this public repository.

### Fixed

- `headsign claim` handed the run to the wrong driver whenever it was
  claimed by a delegated agent. A delegated agent's turn end fires no `Stop`
  hook at all, so the armed marker sat until some *session* stopped —
  typically the one that had just delegated the work — and that session was
  recorded as driver instead; re-claiming converged on the same wrong result
  rather than correcting it. Sealing now happens on the claiming agent's own
  turn end via the `SubagentStop` hook, which identifies that agent
  specifically, and `Stop` no longer reads the claim marker at all — so a
  session can no longer take a seat meant for an agent. See
  [ADR-0010](docs/adr/0010-subagent-stop-identity.md).
- If you have been running the development version through a live patch: a
  run claimed *before* this change carries a driver stamp of the old kind,
  which neither hook now matches — nothing misfires, but that run's stop
  backstop is off (no stop is nudged). Run `headsign claim` again from the
  agent that should be driving, or start a fresh run with `headsign start`,
  to restore it. Runs claimed after this change need nothing.

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
