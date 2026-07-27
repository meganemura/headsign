# ADR-0012: Removing the tree-hash cache — every `next` is a judgment

- Status: accepted
- Date: 2026-07-27
- Supersedes: the tree-hash cache decision in
  [ADR-0004](0004-state-attempts-and-cache.md). Only that one: ADR-0004's
  state shape, per-phase attempts, cwd-only resolution, the concurrency
  lock, and `.headsign/log` all stand.

## Context

ADR-0004 gave `headsign next` a cache. Before running a phase's gate,
headsign fingerprinted the working tree; if that fingerprint matched the one
stored with the last failed evaluation of the same phase, it reprinted that
verdict and returned — no gate run, no `attempts` or `total_iterations`
increment, no state written, no log line. `max_attempts` therefore counted
*failures observed on a tree that had changed since the last one*, not
failures.

### It was the right decision when it was made

`headsign next` was then the only question an agent could ask (ADR-0002),
and it was the only way to see where a run stood. Looking and judging were
the same act, so looking cost an attempt. An agent told "when in doubt, run
`headsign next`" and obeying literally could spend a phase's whole budget
without doing anything wrong, and the only advice that would have prevented
it — *ask less* — attacks the one discipline the tool exists to install.
Something inside `next` had to be free, and "the tree has not changed since
the verdict I already printed you" is the one condition under which
reprinting an old verdict is provably honest rather than merely cheap.

### What changed: looking got its own command

0.2.0 added `headsign status` (ADR-0008), read-only by construction: it runs
no check, writes no state, takes no lock, and its first line is a report
(`RUNNING` / `COMPLETE` / `ESCALATED` / `ABORTED`) rather than a verdict.
The pressure that made the cache necessary was that there was no way to look
without judging. There is now — and it is the better answer, because it also
works on a *changed* tree, which is exactly when an agent most wants to see
the phase, the attempt count, and the last failure, and exactly when the
cache had nothing to offer.

Two mechanisms were answering one need, and only one of them was a
mechanism.

### What the cache cost to keep

It was priced backwards: **paid on every call, refunded occasionally.**
Every `next` computed the fingerprint — `git rev-parse`, `git status
--porcelain -uall`, a content hash per reported path, plus a hand-rolled
walk of `.headsign/` — while the refund arrived only on calls where the
caller had changed nothing since the previous ask. The ordinary case, an
agent that did the work and then asked, paid the mechanism's full cost and
collected nothing from it.

`src/treehash.ts` was 71 code lines, and the idea in it is one line. The
rest was exceptions, each a real bug fixed at the time:

- `git status --porcelain` reports paths relative to the repository root,
  not the cwd, so a `.headsign/` living in a subdirectory of a larger
  repository fingerprinted nothing until the module resolved
  `--show-toplevel` itself;
- that top-level comes back symlink-resolved, which on macOS (`/tmp` →
  `/private/tmp`) does not match the path headsign was invoked with;
- `.headsign/` is normally gitignored, yet gates legitimately read files
  under it (a review verdict, a route file), so the module walked that
  directory by hand, outside git;
- and `state.json`, `lock`, and `log` had to be carved back out of that
  walk, because headsign writes them itself — hashing them would have made
  every evaluation invalidate its own cache.

It was also headsign's only use of git. With the module gone, the tool
spawns exactly one kind of process: `/bin/sh -c`, running the check commands
a workflow author wrote.

### What the cache hid

A cache hit wrote nothing — no attempt, no iteration, no `.headsign/log`
line. That is the property it was built for, and it has a shadow. An agent
that tries to stop mid-run is pushed back to `headsign next` by a
stop-boundary hook (ADR-0006); if it answers each nudge with a bare `next`
and no work in between, every one of those calls hit the cache and reprinted
the same verdict, leaving no trace. `attempts` never moved, so `max_attempts`
could never trip. What tripped instead was the hook's nudge cap: five
nudges, a `stalled` line in the log, and from then on the hook fails open and
lets the agent go. A run that was making no progress ended by being quietly
dropped, and nothing asked a human about it — finding it required someone to
notice that `status` still said `RUNNING` and to go read the log's tail.

Without the cache those same calls are judgments. They count, and a phase
that declares `max_attempts` reaches its exhaustion route — by default
`ESCALATE: <phase>: max_attempts exhausted`, which is how a stuck run gets
handed back to a person, the entire reason a budget exists. (A phase with
no `max_attempts` still leans on `limits.max_total_iterations`, and a
workflow that declares neither bounds nothing; that is unchanged here.)

## Decision

### 1. The cache is removed

`src/treehash.ts` is deleted, along with `shouldUseCache()` / `cachedRetry()`
in `engine.ts`, the tree-hash argument threaded through `step()`, the
`cached` field on the RETRY outcome, and the `(unchanged)` /
`[cached — tree unchanged, attempt not counted]` lines `render.ts` printed on
a hit.

A `next` on a running phase now runs that phase's gate and records the
result. The two paths that answer without judging are unchanged, and neither
is a cache: a terminal run reprints its outcome idempotently, and a phase
whose `ready:` probe fails answers `PENDING` before the gate is reached,
spending nothing (both ADR-0002).

### 2. `max_attempts` counts judgments

The rule is one line: **a judgment costs one attempt.** Ask twice, and you
are judged twice.

That is the user-visible semantic change. It replaces "counts failed
evaluations made on a tree that changed since the last one" — a rule that
took a paragraph to state and a `git status` to enforce.

The discipline that follows from it, which README.md and the `workflow`
skill now teach in place of "probing is free": **did work → `next`; want to
look → `status`.**

### 3. `last_eval` becomes `last_failure`

The state field that fed the cache is renamed and trimmed. `tree_hash` (only
the cache read it) and `result` (always `"fail"`) are gone. `phase`,
`check`, `run`, `exit_code`, `output_tail`, and `timeout_seconds` stay,
because `status` prints them as its `--- last failure: … ---` block — now
the field's only reader, and the only reason it still exists.

"Last eval" was never accurate. The field is `null` after a pass, after a
fail-route, and in every terminal state; only a failure that leaves the run
sitting in its own phase is ever stored there. `last_failure` says that, and
matches what `status` already calls it on screen.

Not `current_failure`: by the time anyone reads the field, the agent may
have fixed the failure and not yet run `next`. What headsign can honestly
claim is the last failure it observed, not that the failure is still there.

No compatibility shim is provided: a `state.json` holding `last_eval` was
written by an older version and is not migrated (see the changelog's
Upgrading note).

## Alternatives considered

**Count only distinct failures — "the same failure twice doesn't count
twice."** This keeps a refund without needing git: compare the new failure
against `last_failure` and skip the increment when they match. Rejected
because it protects precisely the case the budget exists to catch. An agent
that edits code and produces the identical failing check, round after round,
is the canonical `max_attempts` escalation: it is working, it is getting
nowhere, and a person should be told. Under this rule the count would freeze
exactly there, and the run would loop until `limits.max_total_iterations`
noticed, if the workflow set one.

## Consequences

- **Gates run on every `next`.** Two calls in a row run the test suite
  twice. That is the accepted cost, and it follows from the semantics being
  bought: asking twice judges twice. Workflows already have a reason to keep
  gates cheap and idempotent — a fresh `start` after an abort replays every
  phase's gate from scratch — and this makes that advice matter on the
  ordinary path too.
- **A run that is not progressing now ends by asking a human** — `ESCALATE`
  once the phase's `max_attempts` runs out — where it used to end in a
  `stalled` line and a hook that had stopped nudging.
- **Breaking for state files.** A `state.json` written by 0.2.0 carries
  `last_eval`; this version reads `last_failure`. Finish or abort a run
  before upgrading, or start it again afterwards.
- **One less thing to be true about the environment.** headsign no longer
  runs git, so it behaves identically inside a repository, outside one, in a
  linked worktree, or in a directory git refuses to read. ADR-0004's two
  cache caveats — the cache silently disabling itself outside a git repo,
  and a gate that reads network or wall-clock state being served a stale
  verdict — disappear with the mechanism that produced them.
- **`src/` gets smaller**, by the deleted module plus its call sites;
  [architecture.md](../architecture.md) carries the current count and is the
  one place it is written down.
