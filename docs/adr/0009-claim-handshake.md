# ADR-0009: The claim handshake — session identity is hook-side knowledge

- Status: superseded by [ADR-0010](0010-subagent-stop-identity.md)
- Date: 2026-07-25

> **Superseded 2026-07-25 by [ADR-0010](0010-subagent-stop-identity.md).**
> The reasoning below stands — the CLI cannot name itself, so only a hook
> can seal a driver — but this ADR pointed it at the wrong event.
> Measurement showed that a delegated agent's turn end fires **no `Stop`
> hook at all**, so the marker this ADR arms was always consumed by
> whichever *session* stopped next, systematically seating the party the
> handshake existed to displace. Sealing moved to `SubagentStop`, and the
> sealed identifier is an agent id rather than a session id; `Stop` no
> longer reads the marker. Read ADR-0010 for the behavior that ships. The
> text below is kept for the reasoning it establishes, which ADR-0010
> carries forward unchanged, and because its "Honest weakness" section
> under-states the real failure — see the note there.

## Context

A fourth round of field feedback reopened ADR-0008's driver-ownership
design. That ADR leaned on `CLAUDE_CODE_SESSION_ID` in a session's Bash
environment as a stand-in for "this session's identifier," on the strength
of one measured fact: in a lone Claude Code session, that env var's value
is identical to the `session_id` field the Stop hook receives on stdin for
the same session. Measured again on 2026-07-25, against two separate
environments running Claude Code's agent-teams feature, a second fact
surfaced that the first one didn't cover: **`CLAUDE_CODE_SESSION_ID` is
process-granular, not session-granular.** A teammate — an independent
session with its own turn loop and its own Stop-hook firings — inherits
the *lead* session's process environment, so its Bash tool sees the lead's
session id, not its own. Nothing about a single-session test could have
surfaced this; it only shows up once more than one session shares a
process tree.

The consequence is worse than a missed stamp — it inverts the protection
ADR-0008 built. When a coordinator teammate runs a bare `headsign next`,
the env-based auto-stamp (ADR-0008 Decision 1) resolves
`CLAUDE_CODE_SESSION_ID` and writes the *lead's* id into `driver_session`,
because that is the only id its Bash tool can see. The Stop hook, by
contrast, reads `session_id` from its own stdin payload — genuinely
session-granular, supplied by Claude Code per hook firing, never read out
of a shared process environment. So: the lead's own Stop-hook firing sees
`hookSid == driver` (both are the lead's real id, since the wrong stamp
happened to be exactly the lead's own id) and falls through to the nudge
path meant for an unresponsive driver, even though the lead never drove
anything. The coordinator's own Stop-hook firing sees `hookSid` (its own
real id) permanently disagreeing with `driver` (the lead's id, wrongly
stamped) and gets waved straight through by ADR-0008's
confirmed-mismatch pass-through — the exact path built to protect an
*observer* from being nudged. The tool ends up nudging the session that
is not working, and excusing the one that is.

Explicitly exporting `HEADSIGN_SESSION_ID` to a distinct, per-teammate
value does not repair this, for a subtler reason. `next`'s auto-stamp
would happily pick up that explicit value — `HEADSIGN_SESSION_ID` already
outranks `CLAUDE_CODE_SESSION_ID` in `resolveSessionId`'s priority
(ADR-0008) — and write it into `driver_session`. But the hook's own
`hookSid` resolution prefers the stdin `session_id` field whenever the
payload carries one, and the payload always carries one: `hookSid` stays
Claude Code's real, internally-assigned id for that firing, never the
string a human typed into `export`. The stamped `driver_session` and the
hook's own `hookSid` are now guaranteed to disagree, permanently — the
driver looks like a confirmed mismatch on every one of its own stops, and
ADR-0008's pass-through waves it through forever. The nudge protection
does not just misfire here; it silently disappears for the one session
that most needs it.

The fact underneath both failures: **only the Stop hook, reading its own
stdin, knows a session-granular identifier. The CLI — whatever it reads
from its own process environment — cannot, in principle, know which of
possibly several sessions sharing that environment it is currently running
as.** No change to *what* the CLI reads fixes this; the CLI is asking the
wrong party. The right party is the hook, and the right moment is the next
one it can answer with certainty: its own next firing.

(Two smaller items travel with this change but are not part of this ADR's
decision: no-argument `headsign validate` now defaults to a named/running
run's own `workflow_path` the same way `start`/`next` already resolve one,
instead of always falling back to the bare `.headsign/workflow.yaml`; and
`docs/maintenance.md` gained a live-patch procedure for testing hook/skill
changes against a repository's installed plugin copy without a full
release cycle.)

## Decision

### The two-beat claim procedure

A new command, `headsign claim`, does not itself decide who drives
anything — it cannot; nothing running as the CLI can resolve a
session-granular id, which is the whole problem above. What it can do is
drop a marker — an empty file at `.headsign/tmp/claim` — and tell the
session to do the one thing only the *next* Stop-hook firing can finish:
end its turn.

```
CLAIM armed
Now end your turn. The next session to stop seals the claim: the Stop hook
records that session as this run's driver and confirms it in its message.
If another session happens to stop first and gets adopted by mistake, run
`headsign claim` again from the right session — a new claim always wins.
```

This borrows the stop-note device ADR-0006 already introduced for
pausing: a single file under `.headsign/tmp/` whose presence the hook
reads and whose consumption (deletion) makes the signal fire exactly
once. Where the stop-note is an **exit ticket** — write it, stop, and the
hook lets you out immediately — a claim marker is closer to an
**appointment form**: dropping it does not itself seat anyone in the
driver's chair; it registers that some session is applying for the seat,
and only the party that can verify identity — the Stop hook, reading its
own stdin — actually seats the applicant. `claim` requires a `running` run
(state must exist and `status === "running"`; anything else, including no
run at all, exits 3 — there is nothing to claim ownership *of*) and never
writes `driver_session`/`driver_source` itself; the marker's existence is
the only effect, and re-running `claim` is harmless (the marker is simply
recreated).

### The adoption gate, and why it runs before owner comparison

The Stop hook gains a new step, evaluated only while a run is `running`,
and placed **before** the owner-match comparison ADR-0008 added: if
`.headsign/tmp/claim` exists, resolve this firing's session id the same
way owner-match already does (stdin's `session_id`, falling back to
`HEADSIGN_SESSION_ID` from env) and, if that resolves to a non-empty
string, **adopt**: delete the marker, write `driver_session` to the
resolved id and `driver_source` to `"claim"`, reset `stop_nudges` to 0,
append a `claimed` line to `.headsign/log`, and block the stop (exit 2)
with a confirmation naming the workflow and phase —
`Claim confirmed: this session now drives workflow '<name>' (phase:
<phase>). Run \`headsign next\` and follow its verdict.` — plus the same
pause/abort exit guidance every other block carries.

Order here is load-bearing, the same way it already was for owner-match
versus the exit-note gate (ADR-0008). Had owner comparison run first, a
claiming session whose stop happens to disagree with whatever stale
`driver_session` is still on file would be waved straight through by the
confirmed-mismatch pass-through — the very session the marker exists to
hand ownership *to* would sail past the gate meant to adopt it, and the
claim would never seal. Running adoption first intercepts exactly that
case: a claim in progress takes priority over trusting a driver stamp that
the claim itself exists to correct.

Blocking here (exit 2, effectively `block: true`) is the one place this
feature departs from ADR-0006's fail-open rule for new hook branches —
every other addition to the hook, before this one, only ever adds a new
way to let a session *through*, never a new way to hold one. This
exception is deliberate and narrow: the block is not aimed at an innocent
bystander guessing wrong; it is the direct, requested response to a
session that just ran `headsign claim` and was told, in that command's
own output, to expect exactly this. Not blocking here would silently
discard the very confirmation the command promised.

### Adoption is fail-open on an unresolvable id

If the marker exists but this firing's session id cannot be resolved from
either stdin or `HEADSIGN_SESSION_ID` — the same "neither side available"
case ADR-0008 already treats as unproven, not disproven — the hook leaves
the marker in place and falls through to the rest of its decision order
unchanged. The stop this firing describes is not provably the claim's
intended target, so it does not get to consume the one-shot marker; the
marker keeps waiting for a firing that *can* answer. It does not linger
forever by accident: `headsign start` empties `.headsign/tmp/` on every
fresh run (ADR-0004), so an unclaimed marker from an abandoned attempt
disappears the next time the directory is genuinely started fresh — the
same housekeeping that already keeps a stale stop-note from outliving its
run.

### Claimed ownership is sticky

`next`'s existing auto-stamp (ADR-0008: refresh `driver_session` whenever
the environment resolves a positive id that differs from what is stored)
gains one more condition: it only overwrites when `driver_source` is not
exactly the string `"claim"`. A driver seated by the claim handshake stays
seated through ordinary env-based `next` calls from *other* sessions that
still resolve the same old, process-granular id — the whole feature would
be pointless if the next teammate `next` call, from the same shared
environment, could silently un-claim it a moment later. Any value other
than the exact string `"claim"` — absent, `"env"`, or a legacy/corrupt
value — is treated as ordinary and overwritable, the same tolerant-reader
idiom the rest of `state.json`'s fields already use for missing or
malformed data. `cmdStart` always stamps a fresh `driver_source` (`"env"`
if an id resolved, `null` if not) on every new run — a fresh run starts
with a clean slate by definition, so there is no prior claim to protect.

### `status` reports `claimed` because the CLI cannot judge it

ADR-0008's `status` command compares its own resolved session id against
`driver_session` and reports `this session` / `another session` /
`unknown`. That comparison is exactly the operation this ADR opened by
declaring unreliable for the CLI inside an agent-teams process tree — the
same env resolution that mis-stamped `driver_session` in the first place
would just as happily mis-judge `status`'s own "is it me" question,
telling a teammate `this session` when it means the lead, or the reverse.
Rather than repeat that mistake in a different command, a run whose
`driver_source === "claim"` gets a fourth, distinct value — `driver:
claimed` — and `status` asks nothing further. It is not a judgment of
whose session this is; it is an honest statement that ownership here came
from the handshake, precisely because the CLI has no reliable way to say
more. The inability to answer "this session or another" is the very
reason `claim` exists, so `status` says so plainly instead of guessing.

### The `claimed` log line carries no session id

`.headsign/log` gains `claimed` as a third hook-boundary event alongside
`paused` and `stalled` (ADR-0004/ADR-0006's narrow exception to "log real
transitions only") — the moment a run changes hands this way is worth a
record, the same reasoning that put `paused`/`stalled` there. Unlike
those two, its detail field is empty: the session id that was just
adopted already sits in `state.json`'s `driver_session`, in the clear, and
that does not change here — but the log is a devlog read outside that
one file's context, and there is no reason to widen a session
identifier's blast radius into a second artifact just because an event
happened to involve one. The line says a claim was sealed, and for which
phase; it does not say by whom.

## Honest weakness: the adoption race

The handshake is not deterministic. Between `headsign claim` dropping the
marker and the *intended* session's own next stop, any other session
sharing the same run directory can itself stop first — and if that stop
resolves a session id at all, the adoption gate has no way to tell it
apart from the one the marker was meant for; it adopts whichever
qualifying firing arrives first. The window is narrow (one stop's worth
of latency) and self-repairing: running `headsign claim` again from the
correct session drops a fresh marker, and the correct session's own next
stop adopts it, overwriting the wrong adoption — `claim` is idempotent,
and "a new claim always wins" exactly as the command's own output says.
But it is a race, not a guarantee: this ADR does not claim determinism,
only that the handshake is practically near-certain to seat the intended
session when just one session is actually racing to stop next. This
weakness is named openly here, and again in SKILL.md, rather than hidden
behind the confidence of the confirmation message.

**This section under-stated the problem
([ADR-0010](0010-subagent-stop-identity.md), 2026-07-25).** It described
a narrow window and a self-repairing remedy; the measured behavior was
neither. A delegated agent's turn end fires no `Stop` hook, so the
intended claimant could not win the race at all — the marker waited for
whichever session *could* fire `Stop`, which in a lead-plus-teammate
setup is reliably the lead. "A new claim always wins" was true of markers
and false of outcomes: re-claiming converged on the same wrong driver
every time. The confidence in the paragraph above came from reasoning
about a race between symmetric participants that was never symmetric —
and never measured. ADR-0010 keeps a race, but one whose loser can always
correct it, because the intended agent's own turn end is guaranteed to
fire the event that seals.

## Alternatives considered and deferred/rejected

**(a) Detect `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and disable the
auto-stamp.** Considered and deferred, not adopted, this round: it would
add a second undocumented, Claude-Code-internal environment variable to a
design that already leans on one (`CLAUDE_CODE_SESSION_ID`, ADR-0008),
compounding exactly the fragility that variable's own section already
names as a risk. Kept in reserve as the next move if the claim handshake
proves insufficient on its own — this ADR does not rule it out, it just
declines to reach for a second undocumented dependency before the first,
cheaper fix (a new command, no new env sniffing) has had a chance to be
enough.

**(b) A file convention alone, no new command.** Rejected outright: the
claim procedure has two beats — drop the marker, then end the turn — and
the second beat is the one that actually matters (nothing adopts anything
until a Stop-hook firing happens). A bare file convention ("create this
path yourself") has no one on the ground teaching that second beat; a
session or a human told to "drop a marker file" has no obvious reason to
also end its turn immediately afterward, and a marker that sits there
while the same session keeps working just becomes a landmine for
whichever session happens to stop next, claimed or not. A command's own
output line — "Now end your turn." — is the teaching mechanism a bare
file path cannot carry on its own.

## Outlook

If a future Claude Code release makes session identifiers in the Bash
environment session-granular rather than process-granular, the failure
this ADR exists to fix disappears, and `claim` becomes an unneeded extra
step for a case that no longer arises — a good outcome this design does
not depend on and is not blocked by.

## Consequences

- `state.json` gains `driver_source: "env" | "claim" | null` (ADR-0004);
  every reader of `driver_session` that cares about stickiness must check
  it, and every reader that only cares who is currently stamped can ignore
  it.
- The Stop hook's block on a resolvable claim marker is the first (and, as
  of this ADR, only) exception to ADR-0006's "new branches only ever let
  sessions through" rule; it is scoped narrowly, to a firing that follows
  an explicit, just-issued `headsign claim`.
- `headsign` grows a sixth command (ADR-0002); `claim` runs no gate,
  transitions no phase, and answers no verdict, so "the one judging
  question is `next`" is unchanged.
- Multi-session delegation ("teammate, please drive this run") now has a
  taught, two-step handoff instead of relying on an environment quirk to
  happen to work: `headsign claim` from the intended driver, end the turn,
  read the hook's confirmation. See the README's "Multiple sessions"
  section and SKILL.md.
