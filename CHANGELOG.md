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

### Changed

- The Stop hook's nudge cap is now purely an abnormal-case backstop and was
  raised from 3 to 5; the pause note is the intended exit for deliberate
  stops.

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
