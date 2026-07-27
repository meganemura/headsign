# ADR-0008: Multi-session runs — driver ownership, observers, and status

- Status: accepted
- Date: 2026-07-25
- Revised: 2026-07-27 (Decisions 1–3, the environment-derived driver stamp
  and the `Stop` owner match it fed, are retracted by
  [ADR-0013](0013-claim-only-driver-identity.md): a driver is now sealed by
  the `SubagentStop` adoption gate or not at all. Decisions 4–6 — the
  `HEADSIGN_OBSERVER` opt-out, the read-only `status` command, and the
  discipline that non-drivers call `status` — stand unchanged.)

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
not hook protocol — keeping ADR-0001's thin-harness layering intact. (That
module is gone since ADR-0013: with identifier resolution removed, the one
remaining env lookup, `isObserver()`, moved in with its only caller,
`stophook.ts`.)

### 1–3. The environment-derived driver stamp — retracted by ADR-0013

> **Retracted 2026-07-27 by
> [ADR-0013](0013-claim-only-driver-identity.md).** These three decisions
> were one mechanism: `start` and `next` resolved a session identifier from
> the environment and stamped it into `state.json` (1); the identifier came
> from an explicit override variable, else from Claude Code's own session
> variable, with the hook drawing on the same precedence behind its stdin
> field (2); and the `Stop` hook passed a stop through when its own
> identifier and the stamped one both resolved and disagreed (3).
>
> It is gone because the identity it could produce was the wrong one. A
> delegated agent shares its spawning session's process and environment, so
> the stamp named that session however the run was actually being driven,
> and the agent's turn end fires no `Stop` at all — measured in
> [ADR-0010](0010-subagent-stop-identity.md), whose corrections to this
> section this retraction replaces. The explicit override was worse than
> unused: the CLI preferred it while the hook preferred its own stdin
> `session_id`, so setting it made the two sides disagree permanently and
> quietly disabled the setter's own backstop. Ownership is now sealed in
> exactly one place, the `SubagentStop` adoption gate (ADR-0010), and
> `Stop` compares no identifiers at all. ADR-0013 names the variables, and
> records both what was lost with this mechanism — two sessions in one
> directory are no longer told apart — and why the remaining path is worth
> the narrowing; the original text of these sections is in the
> repository's history.
>
> What survives here is the *ordering* argument this section made: the
> driver check runs before the exit-note gate, so a stop that is not the
> driver's can never consume the driver's one-shot pause note. Both hooks
> still keep that order (ADR-0006).

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
look" habit that a bystander has no standing to do at all — and that, since
ADR-0012 retired the free-probe cache, is not free for the driver either:
every `next` judges. A separate command name
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
headsign has no session-authentication layer, and the ownership/observer
machinery above is a backstop against nudging the wrong session, not
access control on invoking commands directly. Every place this
prohibition is stated pairs it with what to do instead: run `headsign
status` to see what's happening without touching anything.

## Consequences

- The nudge-cap safety net (ADR-0006) is protected from a bystander's own
  stops wherever headsign knows who the driver is: an observer's stop
  resolves at `isObserver`, or — on a run a delegated agent has claimed —
  at the driver pass-through that replaced this ADR's owner match
  (ADR-0013), never reaching the shared `stop_nudges` counter. A `stalled`
  line then keeps meaning what ADR-0006 says it means: a genuinely stuck or
  departed driver, not an artifact of who else happened to be in the
  repository. On a run nobody has claimed, that protection is
  `HEADSIGN_OBSERVER` and nothing else — ADR-0013 weighs what retracting
  the stamp gave up here.
- Ownership no longer changes by driving: a run is handed over with
  `headsign claim` (ADR-0010), and there is no state to reset by hand.
- A repository where nobody has claimed the run behaves exactly as it did
  before this ADR: no driver is recorded, and every session that stops in
  the run's directory gets nudged (`SubagentStop`, which needs a positive
  match, holds no delegated agent there — ADR-0010). This ADR only ever
  adds a way to pass more sessions through cleanly; it never adds a new way
  to block one.
