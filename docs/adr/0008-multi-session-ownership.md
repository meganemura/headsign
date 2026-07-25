# ADR-0008: Multi-session runs — driver ownership, observers, and status

- Status: accepted
- Date: 2026-07-25

## Context

Real-world usage surfaced a third round of field feedback, this time about
running headsign with more than one Claude Code session open on the same
repository — a lead session plus teammates, or a subagent doing work
alongside the session that spawned it. The Stop hook (ADR-0006) fires on
every session's turn end, not just the session actually driving the run:
while a run is `running`, any session that stops gets told to `headsign
next`. A session that isn't driving the run has no business obeying that —
if it does, it burns a retry or advances a phase nobody asked it to touch.

The problem is worse than noise. Every blocked stop — driver's or
observer's — increments the same `state.json` field, `stop_nudges`, the
nudge-cap safety net ADR-0006 built as a last resort against a genuinely
stuck or silently departed agent. A handful of *bystander* turn-endings can
therefore exhaust that cap on their own: the fifth nudge (from any session)
logs a `stalled` line even though nothing is actually stuck, and every stop
after that — including the driver's own — passes through unblocked,
quietly disabling the one guarantee ADR-0006 exists to provide. This is a
correctness bug, not friction: a session that never asked the question can
consume the answer meant for the one that did.

Multi-session use is judged to be a normal, ongoing mode of operation for
this tool going forward, not an edge case to special-case away — headsign
needs to know, structurally, which session is driving a run.

## Decision

Identifier resolution and observer detection live in a new module,
`src/session.ts`, that knows only about the environment — not state shape,
not hook protocol — keeping ADR-0001's thin-harness layering intact.

### 1. Stamp `driver_session` on `start` and `next`

`state.json` gains a `driver_session: string | null` field (ADR-0004).
`start` stamps it from whatever session identifier the environment resolves
at that moment (`null` if none does). `next` refreshes it, after its
lock-protected fresh re-read of state, whenever the environment resolves a
*positive* identifier that differs from what's stored — never on a negative
read: if the environment can't produce an identifier, the existing
`driver_session` is left exactly as it was, so a driver that loses its
session-id env mid-run never orphans the run to "nobody drives this."
Ownership therefore always tracks whichever session most recently drove the
run with a resolvable identifier — including a driver that stepped away and
simply calls `next` again later; no separate "reclaim" step exists or is
needed. The PENDING path still stamps (a positive identifier is still
available and still worth recording) but changes nothing else — attempts
and iteration counts stay untouched, matching ADR-0002's rule that a
`ready:` probe is not an evaluation. Ownership transfers are not logged
(ADR-0004's log stays scoped to real transitions plus `paused`/`stalled`).

### 2. Identifier sources, in priority order — and one is not a public API

| Source | Set by | Resolved when |
|---|---|---|
| `HEADSIGN_SESSION_ID` | the user/harness, explicitly | any non-empty value, trimmed |
| `CLAUDE_CODE_SESSION_ID` | Claude Code, automatically | checked only if the above is unset/empty |

Both `resolveSessionId` and, on the hook side, the stdin `session_id` field
draw from this precedence (the hook additionally accepts `session_id` from
the Stop-hook payload before falling back to `HEADSIGN_SESSION_ID` from
env — see Decision 3).

Two facts, measured against a live Claude Code session (2026-07-25),
justify leaning on `CLAUDE_CODE_SESSION_ID` at all: it is present in a
Claude Code session's Bash environment, and its value is identical to the
`session_id` field the Stop hook receives on stdin for that same session —
so a `next` call and the Stop hook firing at the end of that turn are
provably talking about the same session without headsign having to thread
an identifier through itself. A subagent's Bash tool inherits its parent
session's `CLAUDE_CODE_SESSION_ID` unchanged, so a driver that delegates
`headsign next` to a subagent — an ordinary pattern this project's own
skill uses — does not look like a different driver; the delegated call
still stamps the same identifier the parent would have.

**Correction (ADR-0009, 2026-07-25):** a third measurement, taken against
Claude Code's agent-teams feature in two separate environments,
complicates the first of the two facts above: `CLAUDE_CODE_SESSION_ID`
turned out to be **process-granular, not session-granular** — a
teammate's Bash tool inherits the *lead* session's value, not its own.
The equality this section relies on (env value == the Stop hook's own
stdin `session_id`) still holds for a lone session; it does not hold once
more than one session shares a process tree, and Decision 1's env-based
auto-stamp inherits that failure in exactly that case. The owner-match
comparison in Decision 3 below — "both sides resolve and disagree → pass
through" — remains correct exactly as written; what was wrong was one of
the two *inputs* fed into it, not the comparison itself. See
[ADR-0009](0009-claim-handshake.md) for the full failure mode (it inverts
this ADR's protection rather than merely weakening it) and for the
hook-driven `claim` handshake that supplies a trustworthy stamp in
exactly the cases this section's assumption breaks down.

**Further correction (ADR-0010, 2026-07-25):** a fourth round of
measurement pinned the granularity question down completely, and it is
worse than "the env var is process-granular". A delegated agent — a
teammate or a subagent — shares the spawning session's process outright
(same pid, same environment), and its environment contains **no**
identifier of its own under any name; furthermore its turn end does not
fire the `Stop` hook at all. So for a delegated agent there is no
session-granular identifier to be had on either side of this table, and
the event this ADR's Decision 3 reasons about never happens. The
identifier that *does* exist for it is `agent_id`, delivered on a
different event, `SubagentStop`. This ADR's table stays exactly right for
what it covers — one session, one turn loop, an id resolved from the
environment — and `driver_source: "env"` is precisely the marker for
"`driver_session` came from this table". A run whose `driver_source` is
`"claim"` holds an agent id instead, and nothing in this ADR's resolution
path applies to it; see [ADR-0010](0010-subagent-stop-identity.md).

`CLAUDE_CODE_SESSION_ID` is **not a documented, public part of Claude
Code's interface** — it is relied on here only because no public
equivalent exists today. This decision is made with that risk named, not
hidden. If a future Claude Code release removes it, renames it, or changes
what it contains, `resolveSessionId` simply starts returning `null` more
often; `driver_session` stops being (re)stamped for those sessions, and the
hook's owner-match step (Decision 3) always finds at least one side
unresolved and skips the comparison. The system does not fail loudly or
misbehave — it degrades exactly to its pre-this-ADR behavior: every stop on
a running run gets nudged, driver and observer alike. That is the safe
direction to degrade toward, so this decision takes no version pin, no
compatibility shim, and no attempt to detect the variable beyond a plain
existence/non-empty check.

### 3. The hook passes through only on a confirmed mismatch

The Stop hook (ADR-0006) gains an owner-match step, evaluated only while
`status == "running"`: `hookSid` is the stdin payload's `session_id` (a
non-empty string after trim), falling back to `HEADSIGN_SESSION_ID` from
env if stdin doesn't carry one; `driver` is `state.driver_session` (valid
only as a non-empty string). **Only when both resolve, and disagree**, does
the hook pass through — untouched: no state write, the stop-note (if any)
is left unconsumed, no output at all. If either side is unresolved — no
driver has been stamped yet, or this particular stop event carries no
identifier the hook can read — the comparison is skipped entirely and the
hook falls through to its pre-existing behavior, unchanged. This keeps the
new branch on the same side of ADR-0006's fail-open line as everything else
added there: a new way to let an innocent session go, never a new way to
block one. An unresolvable identifier is treated as "can't prove this isn't
the driver," not as "prove it isn't."

**Owner match runs before the exit-note gate, and that order is
load-bearing.** The exit-note gate (ADR-0006) treats
`.headsign/tmp/stop-note` as a one-shot resource: the first stop to find it
non-empty consumes (deletes) it and passes. If a bystander's stop reached
that gate before ownership was checked, an observer's unrelated
turn-ending could read and delete a note the *driver* wrote to pause
deliberately — the driver's own next stop would then find no note, fall
through to the nudge path, and either get nudged for a pause it already
declared, or, worse, contribute to exhausting the nudge cap for no real
reason. Checking ownership first means only a stop that is either the
driver's, or one the hook cannot rule out as the driver's, ever reaches the
note at all — a bystander whose identity is confirmed is waved through
several steps earlier and never touches it.

### 4. `HEADSIGN_OBSERVER` — the manual insurance policy

`isObserver(env)` returns true whenever `HEADSIGN_OBSERVER` is set to any
non-empty value (documented convention: `=1`). Checked first in the hook,
before stdin is even parsed, this is an unconditional pass-through — it
does not depend on any identifier resolving at all. It exists for the case
structural owner-matching cannot cover by itself: a harness or environment
where no session identifier resolves, or simply a session a human knows in
advance is only observing and wants to say so explicitly rather than rely
on inference.

### 5. `status` is the observation window; `next --dry-run` was rejected

A new, strictly read-only command, `headsign status`, answers "what's
going on" for any session, without asking `next`'s question: no gate runs,
no state is written, no lock is taken, and — unlike `next`/`start`/`abort`
— it still never walks up from cwd (ADR-0004's cwd-only rule applies to
`status` too; the hook's walk-up remains its one deliberate exception).

An alternative considered and rejected: give `next` a `--dry-run` flag that
reports without transitioning. Rejected because it would smuggle a second
verb behind the one command ADR-0002 deliberately keeps to a single
question — `next` already means "I am driving, judge me"; a flag that
sometimes makes it mean "actually, just tell me" blurs a distinction this
ADR exists to sharpen, and normalizes exactly the "call `next` just to
look" habit that a bystander has no standing to do at all (a driver may
legitimately probe for free thanks to the tree-hash cache; a bystander
should not be probing the driver's run at all). A separate command name
keeps the vocabulary honest: `next` always means the caller is driving;
`status` always means the caller is only watching.

`status`'s exit code deliberately does not share `next`'s code space (0/1/2
as driver verdicts — ADR-0002). It exits 0 whenever `.headsign/state.json`
could be read, regardless of what it says — an `ESCALATED` or `ABORTED` run
is correctly reported, not a status error — and exits 3 only when there is
nothing to report (no run here, or state unreadable), mirroring `next`'s
own exit 3 for "no run in progress." Reusing `next`'s 0/1/2 would have made
"did the observation itself fail" indistinguishable from "does the run need
help" — a conflation of the same shape ADR-0002 already rejected once, for
a different pair of meanings, when it added `PENDING`.

### 6. Discipline: non-drivers don't call `next`/`abort` — they call `status`

A session that did not `start` a run, and has not been asked (by a human,
or by the driving session) to continue one, must not call `headsign next`
or `headsign abort`. This is taught, not enforced by a lock the CLI owns —
headsign has no session-authentication layer, and the owner-match/observer
machinery above is a backstop against nudging the wrong session, not
access control on invoking commands directly. Every place this
prohibition is stated pairs it with what to do instead: run `headsign
status` to see what's happening without touching anything.

## Consequences

- The nudge-cap safety net (ADR-0006) can no longer be exhausted by a
  bystander's own stops: an observer's stop resolves at `isObserver` or the
  owner-match pass-through, never reaching the shared `stop_nudges`
  counter, so a `stalled` line in the log keeps meaning what ADR-0006 says
  it means — a genuinely stuck or departed session, not an artifact of who
  else happened to be in the repository.
- A driver that steps away and comes back reclaims ownership with a single
  `headsign next` call; there is no separate reclaim command, and no state
  to reset by hand.
- A repository or harness where no session identifier ever resolves
  (`HEADSIGN_SESSION_ID` unset, not running under Claude Code, no
  `HEADSIGN_OBSERVER`) behaves exactly as it did before this ADR:
  `driver_session` stays `null`, the owner-match step always finds a side
  it can't resolve and skips, and every stop on a running run gets nudged.
  This ADR only ever adds a way to pass more sessions through cleanly; it
  never adds a new way to block one.
