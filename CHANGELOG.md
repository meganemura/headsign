# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
During 0.x, a minor bump means feature additions (which may include breaking
changes), and a patch bump means fixes only.

## [Unreleased]

### Added

- **A run now notices when its own workflow changes underneath it.** `next`
  re-reads the file every lap on purpose — that is how you raise a ceiling and
  carry on, and how a run improves the phases it has walked past — but until now
  nothing recorded that it had happened, so a gate could be loosened between two
  laps with the earlier attempts still counted against the stricter version. A
  run now pins a fingerprint of the *rules* it is walking under (every phase it
  can still reach, plus `limits`; `description` deliberately excluded, so
  rewriting instructions stays invisible). A change is reported once as an
  `ESCALATE` that ends nothing and spends nothing: put the file back and the
  next lap is silent and free, or run `headsign next` again to accept it, which
  is counted. `COMPLETE` says how many changes a run accepted, and `status`
  shows the same plus any change still awaiting an answer. A change to `limits`
  alone is accepted without a report, so raising the ceiling stays one stop. It
  is a guardrail, not a lock — anything that can edit the workflow can edit
  `state.json` — but loosening a gate is no longer indistinguishable from the
  edits the documentation recommends. See
  [ADR-0023](docs/adr/0023-pinning-the-graph-a-run-is-walking-under.md).

- **`headsign validate` says when a workflow has no way to stop.** It checked
  that every phase could be *reached* and never that the run could *end*. If a
  set of phases can cycle on pass edges alone — a sweep turning back through its
  queue, say — and no `limits.max_total_iterations` is declared, nothing bounds
  the run: `max_attempts` counts a phase's failures since it last passed, so a
  loop that turns on passes clears it every lap. That is now a warning (still
  exit 0, like the unreachable-phase one), and it carries its reason, because an
  author told only that the graph loops reaches for `max_attempts` — the one
  thing that cannot help. Cycles that close through a *failure* edge are not
  warned about; the failing phase's `max_attempts` really does bound those. See
  [ADR-0022](docs/adr/0022-validate-checks-that-a-run-can-end.md).

### Fixed

- **A gate check that could not be run at all was counted as a check that
  failed.** If the command never started — a working directory that had gone
  away, output past the runner's buffer — headsign had no exit code to read,
  and reported it as an ordinary gate failure anyway: the lap spent an attempt,
  `max_attempts` of them ended the run in `ESCALATE`, and a phase with
  `on_fail: <phase>` moved the run somewhere on the strength of it. The rule
  was already written one function away, where a route's `when:` that cannot be
  run stops the run rather than falling through to the default. Now a check or
  a `ready:` probe that could not be run refuses the lap the same way (exit 3)
  and moves nothing: no attempt, no iteration, no state written, and a message
  naming the command, the errno, and the file to fix it in. A check that runs
  and *times out* is unchanged and still an ordinary failure — it ran, and the
  limit it ran past is one you wrote. See
  [ADR-0021](docs/adr/0021-a-command-that-never-ran-is-not-an-answer.md).

## [0.3.0] - 2026-07-29

### Fixed

- **A stop-boundary hook could erase a running lap's progress.** The hooks
  write the run's record — consuming a pause note, counting a nudge, sealing a
  claim — and a write replaces rather than merges. They took no lock, so a
  hook firing while `next` was mid-lap read the record from before that lap,
  changed one field, and wrote the whole thing back: the lap's phase
  transition and its attempt increment were gone. The lock protected `next`
  from `next` and from nothing else, in a tool built for several agents
  working in one directory — so meeting this needed nothing unusual, just a
  turn ending somewhere while a gate was running. Each hook write now takes
  the lock and re-reads under it; if the lock is held it changes nothing and
  lets the turn end, and an unconsumed pause note or claim marker waits for
  the next one. See [ADR-0004](docs/adr/0004-state-attempts-and-cache.md).

- **Two concurrent `headsign next` calls could both evaluate, and one's
  attempt count could be lost.** The lock was created empty and its pid
  written a moment later, and a second process arriving in that moment found
  an unparseable pid, concluded the holder had crashed, and stole a lock the
  first was still taking. Both then ran the gate and both wrote state, so one
  increment vanished — the exact corruption the lock exists to prevent. It
  needed real contention to hit: delegating a run to several subagents at once
  is the way to meet it, and it failed this repository's own concurrency
  regression test about one run in three under load. The lock is now created
  with its pid already inside it, atomically, so no reader can ever see it
  empty. Stealing a genuinely stale lock is unchanged. See
  [ADR-0004](docs/adr/0004-state-attempts-and-cache.md).

### Changed

- **Reaching `limits.max_total_iterations` no longer ends the run.** It still
  answers `ESCALATE` (exit 2), but writes nothing: the run stays `running`
  (`headsign status` says so), and raising the limit in the workflow file and
  running `headsign next` continues from the same phase, with the same
  attempts and the same `.headsign/tmp/`. The message now says how:

  ```
  ESCALATE build: max_total_iterations (15) reached — the run is still open: raise limits.max_total_iterations in .headsign/workflow.yaml and run `headsign next` to continue from this phase, or run `headsign abort <reason>` to end it
  ```

  The reason it is the only escalation that can be answered this
  way: `max_attempts` exhausted and `on_fail: escalate` mean an agent cannot
  satisfy a gate, while the global ceiling counts every lap and can fire on a
  run doing nothing wrong — it says the run was bigger than the number
  someone typed, which is a thing a person can answer. Those two escalations
  are unchanged and still end the run for good, as does `headsign abort`. The
  runaway protection is unchanged too: the ceiling is still checked before the
  gate, so a run standing at it spends no iteration and no attempt however
  many times it is asked. In `.headsign/log` the event is now written as
  `ceiling` rather than `escalate`, so a log that stops there can't be read as
  a run that ended. See
  [ADR-0017](docs/adr/0017-three-budgets-and-the-recoverable-ceiling.md).
- **`example.headsign/workflow.yaml` is now a generic minimal sample**
  (`name: minimal`) rather than headsign's own development loop. It is still
  the file `headsign start` picks when given no name, and still the smallest
  useful shape — implement behind gates, then a review phase — but its checks
  are placeholders marked swap-me instead of this repository's build and
  version-lockstep commands. `example.headsign/triage.yaml` has left the
  examples entirely: it resolves a private feedback repository through
  `git config --global headsign.feedbackDir`, which made it a workflow only
  this project could run. Both moves come from separating the two
  directories — `example.headsign/` is what ships to be copied, and this
  repository's own workflows now live in a real `.headsign/` directory
  instead of a symlink to the examples. See
  [ADR-0016](docs/adr/0016-explainability-as-the-fitness-function.md).
- **ADR-0007's gate-hardness scale is restated around authorship.** A gate is
  measured (nothing is authored) or judged, and a judged gate sits on one of
  three tiers according to *who writes the verdict file*: the check starts
  the judge and no file survives; the judge writes the file itself; or the
  judge reports and the working agent transcribes. The old wording
  introduced the top tier through its `claude -p` example and was read as a
  recommendation to run that command — the tiers are now stated by
  authorship, with `claude -p` demoted to one way of reaching the top one.
  The middle tier's limit is written down rather than implied: a working
  agent can still overwrite a verdict file it did not write.
- **The ~500-code-line guideline for `src/` is retired.** It never fired:
  `src/` passed twice the number without stopping a feature proposal, while
  the design problems actually found in this project's last eight ADRs all
  announced themselves as an explanation that would not come out straight.
  What replaces it is a workflow, not a number — `.headsign/fitness.yaml`
  asks whether each function in `src/*.ts` can be explained to a
  middle-school reader, and reports the ones that could not by name.
  `docs/architecture.md` now carries the measured size as a dated
  observation rather than a target.
- **Breaking: `version:` must now be `0.1`, not `1`.** Every workflow file
  needs that line changed, and `headsign validate` says so with `version
  must be 0.1 (the schema is pre-1.0 and still changing; a file written for
  the old 'version: 1' needs its fields checked against the current schema,
  not just the number changed)`. The number is the point of the change: `1`
  read as a promise of compatibility, and this schema has taken breaking
  changes on consecutive days — including the three fields removed below.
  While headsign is pre-1.0 the value is matched exactly, `0.2` will be
  matched exactly too, and no compatibility shim accepts an older one: a
  file whose version is out of date is stopped so someone reads it against
  the current schema. See
  [ADR-0015](docs/adr/0015-strict-schema-and-version-0-1.md).
- **Breaking: a key the schema doesn't define is now an error.** `validate`
  used to check the fields it knew and walk past the rest, so `max_atempts:
  3` loaded, validated, and ran a phase with no attempt budget at all. Every
  level of the file is now closed — top level, phase, `gate`, a check, an
  `on_pass` route, `limits` — and an unknown key stops the workflow (exit 3)
  with the keys that level accepts: `phase 'implement': unknown key
  'max_atempts' (allowed: description, clear, ready, gate, on_pass, on_fail,
  max_attempts)`. It is an error rather than a warning because the author's
  intent silently doesn't happen; an unreachable phase stays a warning,
  because a run can proceed with one. No did-you-mean guess is offered — the
  allowed list is printed instead. One consequence lands on the removals
  below: a phase still carrying `env:` or `on_exhausted:` is now rejected
  rather than ignored.
- A run that reads `ABORTED` was ended by a person. With the two `abort`
  routes removed below, nothing headsign judges can produce that status, so
  `status`'s terminal line and the log's `abort` event now say
  unambiguously who ended the run.
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
  attempts, and once `max_attempts` runs out the run ends in `ESCALATE`,
  where before it consumed nothing and could be abandoned quietly. A
  `RETRY` line no longer carries the
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

### Removed

- **Breaking: a phase's `env:` is gone.** Write the variables a check needs
  into the check's own command — `run: "FOO=bar npm test"` — the same way
  you would at a prompt. Every command headsign runs (checks, `ready:`
  probes, and routes' `when:` predicates) now inherits headsign's own
  environment and nothing else. None of the shipped example workflows ever
  used the field. A phase still declaring `env:` now fails `validate` as an
  unknown key, so the field has to come out rather than be left in place —
  see Upgrading. See
  [ADR-0014](docs/adr/0014-removing-three-unused-knobs.md).
- **Breaking: `on_exhausted:` is gone; exhausting `max_attempts` always
  answers `ESCALATE`.** The field chose between `escalate` (the default)
  and `abort`, and every one of its eleven uses across the shipped example
  workflows spelled out the default. A spent budget is the moment to ask a
  person, which is what `escalate` does and what `abort` — noticing the run
  is stuck and then ending it without telling anyone — did not. Like `env:`,
  a leftover `on_exhausted:` is rejected as an unknown key, so a file
  carrying one is stopped rather than escalating on a field nothing reads.
- **Breaking: `on_fail: abort` is gone.** `on_fail` now takes `retry` (the
  default), a phase name, `$end`, or `escalate`. Ending a run for good stays
  a person's decision, made with `headsign abort <reason>` — the command is
  unchanged, and so is the `ABORT` answer token. A workflow declaring it
  fails `validate` with exit 3, as an invalid route rather than an unknown
  key: `on_fail` is still a field, it is `abort` that is no longer one of
  its values. One consequence of `abort` leaving the token set: a phase
  actually named `abort` is now a legal `on_fail` target.

### Upgrading

Finish or abort a run before upgrading, or start it again afterwards: a
`state.json` from 0.2.0 carries `last_eval` and the two ownership fields
this version replaced, so an upgraded-into run loses its recorded driver
(it reads as unclaimed) as well as its last-failure block. If such a run
was being driven by a delegated agent, have that agent run `headsign
claim` again. Drop `HEADSIGN_SESSION_ID` from any shell profile or hook
config that exports it — nothing reads it any more.

Then edit your workflow files, starting with the top line: `version: 1`
becomes `version: 0.1`. That line is not the only thing that moved, though,
which is why the error asks you to check the fields too — three of them left
the schema in this same version. Delete every `on_exhausted:` line:
`escalate` is now what exhaustion always does, so a line that said
`escalate` was already redundant, and one that said `abort` no longer has
anywhere to say it. Delete every `env:` mapping and move its variables into
the commands that need them (`run: "FOO=bar npm test"`). Replace `on_fail:
abort` with `on_fail: escalate` (or a phase name).

All three are caught for you now, along with anything else the schema does
not define: run `headsign validate` on each of your workflow files and fix
what it names, one `unknown key` line at a time. That is also the check to
run on a file you thought was fine — a `max_atempts:` that has been quietly
doing nothing surfaces here rather than in a run. The six answer tokens are
the same six. Do re-read your slowest gate, too — its cost is now paid on
every `next` rather than once per change to the working tree.

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
