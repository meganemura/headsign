# ADR-0004: State shape, per-phase attempts, and the tree-hash cache

- Status: accepted
- Date: 2026-07-23
- Revised: 2026-07-27 (the cache section is retracted by
  [ADR-0012](0012-removing-the-tree-hash-cache.md): the cache is gone,
  every `next` judges, and the state field that recorded the last failed
  evaluation is renamed `last_failure` and trimmed to what `status` shows.
  Everything else here — the state shape, per-phase attempts, cwd-only
  resolution, the lock, and `.headsign/log` — stands.)

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
  "driver_session": null,
  "driver_source": null
}
```

`last_failure` is the failure this run is currently sitting on, and only
that: it is `null` after a pass, after a fail-route, and in every terminal
state, and `status` is its only reader (ADR-0012 explains the name and the
two fields it dropped).

`stop_nudges` belongs to the Stop hook's loop guard, not to attempts
semantics — its lifecycle is owned and explained by ADR-0006. Likewise
`driver_session` — which session (`start`/`next`) most recently drove this
run, or `null` if none resolved one — belongs to multi-session ownership,
not to this ADR's attempts model; its resolution, stamping rule, and
the Stop hook's use of it are owned and explained by ADR-0008. Alongside it,
`driver_source: "env" | "claim" | null` (ADR-0009) records *how*
`driver_session` was last stamped — `"env"` for the ordinary env-based
auto-stamp `start`/`next` perform, `"claim"` for an adoption via
`headsign claim`, and `null` whenever `driver_session` itself is `null`.

Since ADR-0010, `driver_source` also determines **what kind of identifier**
`driver_session` holds, one to one: `"env"` means a session id (which only
a `Stop` firing can match), `"claim"` means an *agent* id sealed by a
`SubagentStop` firing (which only a `SubagentStop` firing can match), and
`null` means neither. No separate field records this — a second source of
truth for something the first already fixes can only ever disagree with
it. Readers that merely record or display `driver_session` need not care;
readers that *compare* it against an identifier of their own must check
`driver_source` first to know whether the comparison is even meaningful
(ADR-0010).

Consumers treat only the exact string `"claim"` as sticky (immune to being
silently overwritten by a later env-based stamp); any other value —
missing, `"env"`, or a corrupt/legacy value — is ordinary and overwritable,
the same tolerant-reader idiom already applied to `driver_session` and
`stop_nudges`. A `state.json` written before either field existed lacks
both keys entirely; readers apply the same missing-means-`null` latitude to
both.

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
  → route `on_exhausted`.

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

### The `lock` file (serializing concurrent `next`)

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
acquire retried once. A holder that crashed mid-evaluation therefore cannot
wedge future runs. The lock is gitignored (`start` ensures this): it is
headsign-internal and transient, not part of the working tree a gate
observes.

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

### `.headsign/log` (the run-scoped transition log)

A sibling of `state.json` and `lock`: `.headsign/log` records every real
transition of a run as one line per event, in order — which phase was
visited, how many times it failed, and why the run ended, so a devlog
written after the fact no longer has to be reconstructed from the
conversation. `start` truncates it: a run scopes its own log, and a
previous run's history must not bleed into a new one. Every other write is
an append.

All I/O for this file lives in `state.ts` (`initLog`/`appendLog`); its line
format lives in `render.ts` (`logLine`), pure text formatting with no I/O
of its own; `cli.ts` captures the timestamp (`localIso(new Date())`) —
still the one place headsign reads the clock — and passes it down to
whichever caller needs it. `cli.ts` itself is the direct caller for every
transition below; `stophook.ts` is the other caller (paused/stalled,
below), and it never calls `new Date()` itself — `cmdStopHook` captures
`localIso(new Date())` and hands it to `evaluate` as an argument, the same
clock-stays-in-cli.ts split this ADR already keeps engine.ts out of.

Four call sites, one line each, for real *transitions*: `start` (truncate,
then a `start` line), `next`'s iteration-limit branch (an `escalate`
line), `next`'s real evaluation after `step()` (a `retry` / `advance` /
`complete` / `escalate` / `abort` line, matching the outcome), and `abort`
(an `abort` line). A terminal-state re-display and a PENDING answer
(ADR-0002) are deliberately silent — neither is a transition, and logging
one would make the log say something happened when nothing did.

**Explicit exception — the three Stop-boundary events** (`paused` and
`stalled` added by the exit-note-gate revision of ADR-0006; `claimed`
added by ADR-0009's claim handshake): none of the three is a `step()`
transition, but the log records them anyway, because each is the only
trace its own kind of Stop-boundary event otherwise leaves behind — a
human-initiated pause, a stuck/departed-agent stall, or a driver handed
off via `headsign claim`. `stophook.ts` appends `paused` when a non-empty
`.headsign/tmp/stop-note` is consumed, `stalled` once, the moment
`stop_nudges` reaches its cap — never on the 1st-through-4th nudge, and
never again on the pass-throughs after the cap trips — and `claimed` once,
the moment the adoption gate seats a new driver via a `.headsign/tmp/claim`
marker (ADR-0009, ADR-0010). All three can now be appended from either
stop-boundary hook: `paused` and `stalled` from whichever of `Stop` /
`SubagentStop` is evaluating the driver's own stop, and `claimed` only
from `SubagentStop`, the sole hook that can seal a claim (ADR-0010).
Unlike the other two, `claimed`'s detail field is empty: the identifier
just adopted already lives in `driver_session`, and the log does not
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
phase for an `advance`, the reason for `escalate`/`abort`, the note's
first line for `paused`, the fixed `nudges=5` for `stalled`, and nothing
(an empty detail) for `claimed`.

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
