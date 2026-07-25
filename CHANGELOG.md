# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
During 0.x, a minor bump means feature additions (which may include breaking
changes), and a patch bump means fixes only.

## [Unreleased]

### Added

- Pause notes: writing one line to `.headsign/tmp/stop-note` lets a session
  stop immediately and quietly — the Stop hook consumes the note, records a
  `paused` line in `.headsign/log`, and leaves the run resumable with
  `headsign next`. Silent exits now always leave a trace.
- A `stalled` line in `.headsign/log` when the Stop hook's nudge cap is
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
  Stop hook, regardless of driver ownership — the manual opt-out for
  environments where no session identifier resolves.
- `headsign claim`: arms a one-shot marker so the *next* Stop hook firing
  that can resolve a session id adopts that session as the run's driver and
  confirms it in its block message — the reliable way to hand off who
  drives a run in environments (e.g. Claude Code's agent-teams feature)
  where a session's own Bash environment can't be trusted to know its own
  session id. See [ADR-0009](docs/adr/0009-claim-handshake.md).

### Changed

- The Stop hook's nudge cap is now purely an abnormal-case backstop and was
  raised from 3 to 5; the pause note is the intended exit for deliberate
  stops.
- The Stop hook's decision order now checks observer opt-out and driver
  ownership before the exit-note gate, so a bystander's stop can no longer
  consume the shared nudge-cap insurance or a driver's pause note — see
  [ADR-0008](docs/adr/0008-multi-session-ownership.md).
- `headsign status`'s `driver:` line now shows `claimed` (instead of
  guessing this-session/another-session) once a run's driver was seated via
  `headsign claim` — the CLI has no reliable way to make that guess in the
  same environments `claim` exists to handle, so it reports the fact it
  does know instead.
- No-argument `headsign validate` now defaults to the current run's own
  `workflow_path` (from `.headsign/state.json`, whatever its status)
  whenever a run exists, falling back to the plain `.headsign/workflow.yaml`
  default only when there is no run; an explicit name or `--workflow`
  still always wins.

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
