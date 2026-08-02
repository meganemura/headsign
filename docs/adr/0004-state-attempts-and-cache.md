# ADR-0004: State shape, per-phase attempts, and the tree-hash cache

- Status: accepted
- Date: 2026-07-23
- Revised: 2026-07-27 (the cache section is retracted by
  [ADR-0012](0012-removing-the-tree-hash-cache.md): the cache is gone,
  every `next` judges, and the state field that recorded the last failed
  evaluation is renamed `last_failure` and trimmed to what `status` shows.
  Everything else here — the state shape, per-phase attempts, cwd-only
  resolution, the lock, and `.headsign/log` — stands.)
- Revised: 2026-07-27 (the two ownership fields become one:
  [ADR-0013](0013-claim-only-driver-identity.md) retired the
  environment-derived driver stamp, so the stored driver is always an agent
  id sealed by the `SubagentStop` hook and the field that used to say which
  mechanism wrote it is gone. The state shape below is updated in place.)
- Revised: 2026-07-28 (the log gains a fourth non-`step()` event, `ceiling`:
  [ADR-0017](0017-three-budgets-and-the-recoverable-ceiling.md) made
  `limits.max_total_iterations` answer without writing state, so that branch
  logs an event of its own instead of the `escalate` line it used to write.
  The `.headsign/log` section below is updated in place.)
- Revised: 2026-07-28 (who calls what, not what happens:
  [ADR-0018](0018-cli-engine-seam.md) moved the five operations that act on a
  run out of `cli.ts`, so `engine.ts` is now the direct caller for every
  logged transition and the holder of the lock described below. The clock
  split this ADR states is unchanged — `cli.ts` still captures
  `localIso(new Date())` and passes it down — and now has a second module on
  the receiving end of it. The paragraphs below are updated in place; no line
  format, log event or lock rule changes.)
- Revised: 2026-08-02 (a second entry next to the cache retraction above,
  this one narrowing what the guarantee covers rather than retracting any
  of it: `gate.ts` now times how long a failing check ran, using
  `process.hrtime.bigint()` — a monotonic clock, not the wall clock this
  ADR gives `cli.ts` sole custody of. The original wording below said
  headsign read the clock in exactly one place; that was true as far as
  it needed to be, because nothing else read any clock yet, and it did
  not need to draw this distinction to be correct at the time. What this
  ADR actually guarantees, restated at that finer grain: the datetime
  that lands on disk — in `state.json` and `.headsign/log` — comes from
  exactly one place, and `step()` never holds a clock of its own.
  Measuring a `spawnSync` interval is a different question, outside that
  guarantee rather than a case carved out of it, taken inside `gate.ts`
  because that module already touches the outside world; `engine.ts`
  still only ever receives a finished, rounded number. The
  `.headsign/log` paragraph below is updated in place; see `src/gate.ts`'s
  module header for the same distinction stated at the call site.)

## Context

State must survive `/compact`: Claude should recover fully from any context
loss with a single `headsign next`. So state.json is the external memory,
and its semantics must make the acceptance scenarios work — including
"review rejects 3 times → escalate" while also "being sent back to
implement grants a fresh budget".

## Decision

### state.json (v1)

```json
{
  "workflow": "feature-dev",
  "workflow_path": ".headsign/workflow.yaml",
  "status": "running",
  "phase": "implement",
  "attempts": { "implement": 2 },
  "total_iterations": 7,
  "last_failure": {
    "phase": "implement",
    "check": "unit tests",
    "run": "bundle exec rspec",
    "exit_code": 1,
    "output_tail": "…"
  },
  "end_reason": null,
  "stop_nudges": 0,
  "driver_agent": null
}
```

`last_failure` is the failure this run is currently sitting on, and only
that: it is `null` after a pass, after a fail-route, and in every terminal
state, and `status` is its only reader (ADR-0012 explains the name and the
two fields it dropped).

`stop_nudges` belongs to the Stop hook's loop guard, not to attempts
semantics — its lifecycle is owned and explained by ADR-0006. Likewise
`driver_agent` — the delegated agent driving this run, or `null` while
nobody has claimed it — belongs to run ownership, not to this ADR's
attempts model; who may write it, and what each stop-boundary hook does
with it, are owned and explained by ADR-0010 and ADR-0013. The name says
what the field holds: the `SubagentStop` adoption gate is its only writer,
and an agent id is the only thing that gate has to write.

A `state.json` written before this field carried that name lacks the key
entirely, and one written by 0.2.0 carries the two fields it replaced.
Readers apply the usual missing-means-`null` latitude, and must get it
right in one specific way: a missing key reads back as `undefined`, so the
test is "a non-empty string", not "not `null`" — the same tolerant-reader
idiom `stop_nudges` already gets.

`end_reason` stores why a run ended for the terminal states that carry a
reason (`escalated`, `aborted`), so `next` can reprint the outcome
idempotently after the fact.

`status` ∈ `running | complete | escalated | aborted`. Writes are atomic
(temp file + rename) so a killed process never leaves half a state file.

### Attempts are a per-phase map, not a scalar

The handoff sketched `"attempts": 2` (a scalar for the current phase).
A scalar cannot honor this workflow:

```yaml
review:
  on_fail: implement   # send back on rejection
  max_attempts: 3      # escalate after 3 rejections
```

With a scalar reset on every transition, review's counter returns to 0 each
bounce and `max_attempts: 3` can never fire. Therefore:

- `attempts[P]` counts **failed evaluations of P's gate since P last
  passed** (or since start). It increments on a counted failure, survives
  transitions away and back, and is cleared when P's gate passes.
- Exhaustion check: after incrementing, if `attempts[P] >= max_attempts(P)`
  → ESCALATE. (This was originally routed by an `on_exhausted` field;
  [ADR-0014](0014-removing-three-unused-knobs.md) removed it and fixed
  exhaustion to escalate.)

This yields both target behaviors: review rejections accumulate to 3 across
bounces (escalate), while implement — whose gate passed on the way to
review — re-enters with a clean 0/5 budget.

### The tree-hash cache — retracted by ADR-0012

> **Retracted 2026-07-27 by
> [ADR-0012](0012-removing-the-tree-hash-cache.md).** This ADR decided that
> a `next` on a working tree unchanged since the same phase's last failed
> evaluation would reprint that verdict for free — no gate run, no attempt
> counted — so that an agent could look at a run without paying for the
> look. `headsign status` (ADR-0008) answers that need directly, and
> without a git fingerprint behind it, so the cache is gone: a `next` that
> reaches a phase's gate evaluates it, and `max_attempts` counts
> judgments. ADR-0012 records what the mechanism was, why it was right when
> this ADR chose it, and what it hid; the original text of this section is
> in the repository's history.

### Resolution: cwd only, never parent directories

headsign resolves `.headsign/` strictly in the current working directory.
It never walks up to a parent directory looking for one — not in the CLI,
not in the Stop hook. Rationale: this keeps git-worktree-based (or otherwise
nested) parallel runs independent — each worktree gets its own `.headsign/`
and one run can never accidentally pick up another's state by virtue of
being invoked from a subdirectory. It also matches the thin, cwd-scoped
model the rest of the tool follows (ADR-0001). The cost of this is a plain
"no run in progress" if you invoke headsign from the wrong directory; `next`
and `abort` say so explicitly and point at running it from the directory
that owns the workflow (usually the repo or git-worktree root). The Stop
hook is the one exception: it walks up from the session's cwd, bounded by
the enclosing git worktree/repo root, to find the run so the backstop still
fires from a subdirectory — `next`/`start`/`abort` themselves stay strictly
cwd-only (see ADR-0006).

### The `lock` file (serializing every writer of the record)

Delegating work to multiple subagents can produce two concurrent `headsign
next` calls against the same `.headsign/`. Without serialization both could
run the gate and both could bump `attempts`/`total_iterations`, corrupting
the count. `next` holds `.headsign/lock` (its own pid written inside) for
the duration of a real evaluation — phase-missing guard through
`step()`/`writeState` — and releases it before printing the outcome. A
second `next` that finds the lock held by a live pid errors out (exit 3)
without touching state; it does not wait or retry.

Stale locks self-heal: if the pid inside `lock` is not a live process
(checked via `process.kill(pid, 0)`, treating `EPERM` as alive and anything
else as dead — including an unparseable pid), the lock is stolen and the
acquire retried once.

That self-healing rule is why **the lock file must never be observable
without its pid in it**, and why it is created by writing the pid to a
private temp file and hard-linking that into place rather than by creating
the file and then writing to it. `link` still fails with `EEXIST` when the
lock is held, so exactly one caller wins — but no reader can catch the file
empty. Creating first and writing second leaves exactly such a moment, and a
reader arriving in it finds an unparseable pid, concludes the holder is dead,
and steals a lock the first process is still in the middle of taking. Both
then believe they hold it, both evaluate, and one's `writeState` silently
overwrites the other's increment — the very corruption the lock exists to
prevent. It was not theoretical: it failed the concurrency regression test
roughly one run in three under load. A holder that crashed mid-evaluation therefore cannot
wedge future runs. The lock is gitignored (`start` ensures this): it is
headsign-internal and transient, not part of the working tree a gate
observes.

**The stop-boundary hooks hold it too**, and did not always. They write the
record — a consumed pause note, a nudge count, a sealed claim — and a write
replaces rather than merges, so a hook that read the record before a lap
finished and wrote its own version back erased that lap's phase transition and
attempt increment. The lock protected `next` from `next` and from nothing
else, in a program built for several agents in one directory. Each hook write
now takes the lock, re-reads under it, and applies its change to what was
actually on disk; if the lock is held it changes nothing and lets the turn end,
which is right twice over — somebody holding it is somebody judging, so the run
is already being driven, and a hook must never be why a turn cannot end. An
unconsumed pause note or claim marker simply waits for the next turn end.

Holding the lock is only useful if the evaluation underneath it acts on
current state, so `next` re-reads state after acquiring the lock and
evaluates against that fresh read, not the snapshot it read before
attempting to acquire — otherwise a process that acquired a freed lock late
could silently overwrite another process's already-written attempt. The
steal path also verifies ownership after its create (two processes can
observe the same dead pid and both attempt to steal; only one's pid can be
the one on disk afterward), and `releaseLock` only removes a lock this
process still owns, so a stealer's fresh lock is never deleted out from
under it by the process it stole from.

### `.headsign/log` (the transition log)

A sibling of `state.json` and `lock`: `.headsign/log` records every real
transition of a run as one line per event, in order — which phase was
visited, how many times it failed, and why the run ended, so a devlog
written after the fact no longer has to be reconstructed from the
conversation.

*(Revised 2026-07-30 by [ADR-0024](0024-the-log-survives-a-restart.md): `start`
used to truncate this file so a run scoped its own log. It no longer does —
every write is an append, and the log survives a restart. The heading above
lost the word "run-scoped" with it.)*

All I/O for this file lives in `state.ts` (`appendLog`); its line
format lives in `render.ts` (`logLine`), pure text formatting with no I/O
of its own; `cli.ts` captures the timestamp (`localIso(new Date())`) —
still the one place headsign reads the **wall** clock for a datetime that
lands on disk — and passes it down to whichever caller needs it.
`engine.ts` is the direct caller for every transition below (ADR-0018 moved
them there from `cli.ts`); `stophook.ts` is the other caller
(paused/stalled, below). Neither calls `new Date()` itself: `cli.ts`
captures `localIso(new Date())` per command and hands it over as an
argument — `nowIso` for both — which is the same clock-stays-in-cli.ts
split this ADR has kept from the start. A monotonic clock is a different
matter: `gate.ts` times how long a failing check ran with
`process.hrtime.bigint()`, entirely inside its own already-world-touching
work (`spawnSync`), and the number that results arrives at `engine.ts` and
`state.ts` pre-measured — neither reads a clock to produce it. What this
ADR actually guarantees, stated narrowly, is that the datetime written into
`state.json` and this log comes from one place, and that `step()` holds no
clock of its own; a monotonic interval measurement is outside that
guarantee, not an exception smuggled past it.

Four call sites, one line each, for real *transitions*: `start` (a `start`
line), `next`'s iteration-limit branch (a `ceiling` line —
see below), `next`'s real evaluation after `step()` (a `retry` / `advance` /
`complete` / `escalate` / `abort` line, matching the outcome), and `abort`
(an `abort` line). A terminal-state re-display and a PENDING answer
(ADR-0002) are deliberately silent — neither is a transition, and logging
one would make the log say something happened when nothing did.

**Explicit exception — `ceiling`** (added by
[ADR-0017](0017-three-budgets-and-the-recoverable-ceiling.md), which made
`limits.max_total_iterations` stop ending the run): the iteration-limit
branch no longer transitions anything — it writes no state at all — but it
is logged anyway, because the run being stopped at the wall and a person
being asked is the event, and nothing else records it. It is not written as
`escalate`: that word means "the run ended by escalation" for its two
remaining producers, and this run is still `running`, so reusing it would
let a reader take a log that stops here for a log of a run that ended.
Repeated `next` calls at the wall repeat the line, deliberately — each is a
real request that was really refused, and how long the run stood there is
part of what the log is for. Unlike the terminal re-display above, nothing
about it says something happened when nothing did.

**Explicit exception — the three Stop-boundary events** (`paused` and
`stalled` added by the exit-note-gate revision of ADR-0006; `claimed`
added by ADR-0009's claim handshake): none of the three is a `step()`
transition, but the log records them anyway, because each is the only
trace its own kind of Stop-boundary event otherwise leaves behind — a
human-initiated pause, a stuck/departed-agent stall, or a driver handed
off via `headsign claim`. `stophook.ts` appends `paused` when a non-empty
`.headsign/tmp/stop-note` is consumed, `stalled` once, the moment
`stop_nudges` reaches its cap — and `claimed` once,
the moment the adoption gate seats a new driver via a `.headsign/tmp/claim`
marker (ADR-0009, ADR-0010).

*(Revised 2026-07-31: the 1st-through-4th nudge are no longer silent. They
append `held`, carrying the count in the same `nudges=` key `stalled` uses.
`stalled` is unchanged — still written once, at the moment the guard trips, and
never again on the pass-throughs after it. So the cap writes `stalled` and not
`held`, one line per event, and a reader counting holds since the last transition
finds four plus the `stalled`, which is five.*

*The rule this revises was spam prevention, and it was decided when nudges were
the whole backstop and nothing else about a turn end was logged. Both halves of
that stopped being true when [ADR-0025](0025-a-stop-that-passed-and-a-stop-that-never-ran.md)
added `unheld` — and it left the log recording three of the four dispositions
`last_stop` tracks, missing the one that happens most. The cost of that was not
the missing line but the two lines it made unreadable: an `unheld` cannot be
read by what precedes it when the most common thing preceding it is invisible,
and `stalled` records a cap being exhausted with no way to count what exhausted
it. ADR-0025 §7 weighed exactly this and accepted it; field use retracted it a
day later, and that section carries the retraction.)* All three can now be appended from either
stop-boundary hook: `paused` and `stalled` from whichever of `Stop` /
`SubagentStop` is evaluating the driver's own stop, and `claimed` only
from `SubagentStop`, the sole hook that can seal a claim (ADR-0010).
Unlike the other two, `claimed`'s detail field is empty: the identifier
just adopted already lives in `driver_agent`, and the log does not
repeat it. This stays a targeted exception rather than reopening "log
everything the hook does" (see ADR-0006, ADR-0009, and ADR-0010 for the
full designs).

Line format: `<ISO-ts> <event> <phase> a=<attempts[phase] ?? 0>
i=<total_iterations> <detail>`, where `<ISO-ts>` is local time with UTC
offset (ISO 8601, second precision) — the log's reader is a human or agent
writing a run report in the user's own timezone, and a numeric offset keeps
the line unambiguous without forcing a mental UTC conversion — and
`<detail>` supplies whatever the event needs beyond those shared fields —
the workflow name for `start`, the failing check for `retry`, the origin
phase for an `advance`, the reason for `escalate`/`abort`/`ceiling`, the
note's first line for `paused`, the fixed `nudges=5` for `stalled`, and
nothing (an empty detail) for `claimed`.

Listed in `.headsign/.gitignore` alongside `state.json`, `lock`, and
`tmp/` for the same reason those are — it is run-scoped,
headsign-internal bookkeeping, not a workflow artifact a team would want
tracked.

### start / abort details

- `start` refuses to clobber a `running` state (exit 3; instruct to
  continue with `next` or `abort` first). Terminal states are overwritten.
- `start` ensures `.headsign/.gitignore` ignores `state.json`, `lock`,
  `log`, and `tmp/`, so run state, the concurrency lock, the transition
  log, and scratch artifacts can never be committed by accident.
- `start` also empties and recreates `.headsign/tmp/`, a run-scoped scratch
  directory for transient artifacts (review verdicts, tickets, notes, and
  — as of the exit-note-gate revision — the Stop hook's `stop-note`; see
  ADR-0006) so nothing from a previous run leaks into this one. Gates
  legitimately read files there — a review verdict, a route file — so it is
  scratch space for the workflow, not headsign-internal state the way
  `state.json` and `lock` are.
- `abort` records the reason and sets `status: aborted` — a correct,
  human-directed ending, which the Stop hook lets pass.

## Consequences

- state.json diverges from the handoff sketch (attempts map,
  `last_failure`); this ADR is the reference for the actual shape.
- Every `next` on a running phase spends an attempt on a failing gate, so
  the discipline the skill teaches is `next` after work and `status` to
  look (ADR-0012, which retracted this ADR's opposite answer).
- `history` and `version` were removed from state.json: nothing ever read
  them back, so they were write-only bookkeeping (and `history` was the
  only reason `step()` needed a clock at all). If an audit log is wanted
  later, design it together with its reader rather than writing it on
  spec. `.headsign/log` (above) is that log, reintroduced later once a
  reader actually existed — a devlog written after a run ends, previously
  reconstructed from the conversation — and designed together with that
  reader rather than sitting write-only the way `history` did. This is
  consistent with, not a reversal of, the removal above: the objection was
  never to a log, it was to writing one before anything read it.
