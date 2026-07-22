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
  "version": 1,
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
  "history": [ { "phase": "plan", "result": "pass", "at": "…ISO 8601…" } ],
  "end_reason": null,
  "stop_nudges": 0
}
```

`stop_nudges` belongs to the Stop hook's loop guard, not to attempts/cache
semantics — its lifecycle is owned and explained by ADR-0006.

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

### start / abort details

- `start` refuses to clobber a `running` state (exit 3; instruct to
  continue with `next` or `abort` first). Terminal states are overwritten.
- `start` ensures `.headsign/.gitignore` ignores `state.json`, so run state
  can never be committed by accident.
- `abort` records the reason and sets `status: aborted` — a correct,
  human-directed ending, which the Stop hook lets pass.

## Consequences

- state.json diverges from the handoff sketch (attempts map, `last_eval`);
  this ADR is the reference for the actual shape.
- The cache makes `next` safe to call compulsively, which is exactly the
  discipline the skill teaches.
