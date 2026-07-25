# ADR-0004: State shape, per-phase attempts, and the tree-hash cache

- Status: accepted
- Date: 2026-07-23

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
  "last_eval": {
    "phase": "implement",
    "result": "fail",
    "tree_hash": "…",
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

`stop_nudges` belongs to the Stop hook's loop guard, not to attempts/cache
semantics — its lifecycle is owned and explained by ADR-0006. Likewise
`driver_session` — which session (`start`/`next`) most recently drove this
run, or `null` if none resolved one — belongs to multi-session ownership,
not to this ADR's cache/attempts model; its resolution, stamping rule, and
the Stop hook's use of it are owned and explained by ADR-0008. Alongside it,
`driver_source: "env" | "claim" | null` (ADR-0009) records *how*
`driver_session` was last stamped — `"env"` for the ordinary env-based
auto-stamp `start`/`next` perform, `"claim"` for a Stop-hook adoption via
`headsign claim`, and `null` whenever `driver_session` itself is `null`.
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

### The tree-hash cache ("watching `next` doesn't cost attempts")

Problem: Claude may call `next` mid-work just to see the remaining-work
list. Those probes must not burn `max_attempts`.

Rule: if the working tree is **unchanged since the last failed evaluation
of the same phase**, reprint the cached RETRY, and do not increment
`attempts` or `total_iterations`. Any change → evaluate for real. Only
changed-tree failures count as attempts.

Fingerprint (`src/treehash.ts`), inside a git repo:

- `HEAD` commit id (so committing counts as a change even with a clean tree),
- `git status --porcelain -uall` entries (tracked changes + untracked,
  `.gitignore` respected), each with a content hash of the file,
- plus every file under `.headsign/` **except `state.json`**, by content.

The `.headsign/` clause exists because that directory is typically
gitignored, yet gates legitimately read files there (`verdict`,
`approved`); without it, writing a verdict would look like "no change" and
`next` would return a stale cached failure. `state.json` is excluded
because headsign itself rewrites it — including it would make every
evaluation self-invalidating.

Outside a git repo (or if git fails): no fingerprint, cache disabled, every
`next` evaluates. Correctness over economy.

Known caveat (documented, accepted): a gate whose outcome depends on state
outside the repository and outside `.headsign/` (network, wall clock) can
be cached stale. Such gates are outside headsign's model; touch any file to
force re-evaluation.

`git status --porcelain` reports paths relative to the git top-level, not
cwd. `src/treehash.ts` resolves the top-level once (`git rev-parse
--show-toplevel`, falling back to cwd if that fails) and joins status paths
against it, so a nested project — `.headsign/` living in a subdirectory of a
larger repo, headsign run from there — hashes the correct files instead of
silently hashing nothing.

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
wedge future runs. The lock is gitignored (`start` ensures this) and
excluded from the tree-hash the same way `state.json` is — it is
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
(an `abort` line). A cached (tree-unchanged) RETRY re-display, a
terminal-state re-display, and a PENDING answer (ADR-0002) are
deliberately silent — none of the three is a transition, and logging one
would make the log say something happened when nothing did.

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
marker (ADR-0009). Unlike the other two, `claimed`'s detail field is
empty: the session id just adopted already lives in `driver_session`, and
the log does not repeat it. This stays a targeted exception rather than
reopening "log everything the hook does" (see ADR-0006 and ADR-0009 for
the full designs).

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

Excluded from the tree-hash cache (`treehash.ts`'s `headsignEntries`
filter and `statusEntries`'s exclusion set) for the same reason
`state.json` is: headsign itself appends to it on every real evaluation,
so leaving it in would make the cache self-invalidating the moment an
entry got appended to invalidate against. Excluded from
`.headsign/.gitignore` alongside `state.json`, `lock`, and `tmp/` for the
same reason those are — it is run-scoped, headsign-internal bookkeeping,
not a workflow artifact a team would want tracked.

### start / abort details

- `start` refuses to clobber a `running` state (exit 3; instruct to
  continue with `next` or `abort` first). Terminal states are overwritten.
- `start` ensures `.headsign/.gitignore` ignores `state.json`, `lock`,
  `log`, and `tmp/`, so run state, the concurrency lock, the transition
  log, and scratch artifacts can never be committed by accident.
- `start` also empties and recreates `.headsign/tmp/`, a run-scoped scratch
  directory for transient artifacts (review verdicts, tickets, notes, and
  — as of the exit-note-gate revision — the Stop hook's `stop-note`; see
  ADR-0006) so nothing from a previous run leaks into this one. Unlike
  `state.json` and `lock`, it is not excluded from the tree-hash: gates
  legitimately read files there, so a write under `.headsign/tmp/` must
  keep invalidating the cache the same way any other `.headsign/` artifact
  does.
- `abort` records the reason and sets `status: aborted` — a correct,
  human-directed ending, which the Stop hook lets pass.

## Consequences

- state.json diverges from the handoff sketch (attempts map, `last_eval`);
  this ADR is the reference for the actual shape.
- The cache makes `next` safe to call compulsively, which is exactly the
  discipline the skill teaches.
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
