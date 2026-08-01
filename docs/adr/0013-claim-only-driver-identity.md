# ADR-0013: Claim-only driver identity — retiring the environment stamp

- Status: accepted
- Date: 2026-07-27
- Supersedes: the environment-derived driver stamp of
  [ADR-0008](0008-multi-session-ownership.md) — its Decision 1 (`start` and
  `next` stamp the driver), Decision 2 (the identifier sources and their
  precedence) and Decision 3 (`Stop`'s owner-match comparison) — and
  Decision 2 of [ADR-0010](0010-subagent-stop-identity.md) (the stored
  `driver_source` deciding which kind of identifier is on file and which
  event may match it). Everything else in both ADRs stands: ADR-0008's
  observer opt-out, its read-only `status` command, and its
  non-drivers-call-`status` discipline; ADR-0010's two-beat claim, its
  `SubagentStop` adoption gate, and its positive-match rule.
- Revised: 2026-08-01 (Decision 1's second clause — that an `agent_id` is
  "the only identifier headsign records anywhere" — and Decision 2 in full
  are retracted by [ADR-0027](0027-recording-who-drove-a-run.md), which
  adds `last_drive`, a session stamp `Stop` compares below the claim check.
  Decision 1's first clause — the `SubagentStop` adoption gate is the only
  writer of a driver identifier — is unaffected: `last_drive` records who
  ran a command, not who drives, so ADR-0027 does not add a second path to
  a driver. Decisions 3–5 — the `driver_agent` rename and `driver_source`'s
  deletion, `status`'s two-valued `driver:` line, and the removal of the
  sticky-ownership rule — stand unchanged.)

## Context

Until this ADR, headsign learned who drives a run in two different ways,
and kept a field on disk to say which of the two had spoken.

The first way came from the environment (ADR-0008): `start` and `next`
resolved a session identifier out of `HEADSIGN_SESSION_ID` or Claude
Code's own `CLAUDE_CODE_SESSION_ID` and stamped it, and the `Stop` hook
compared that stamp against the `session_id` its own stdin carried,
passing a stop through when the two resolved and disagreed. The second
came from a hook (ADR-0009, re-homed by ADR-0010): `headsign claim` arms a
one-shot marker, and the claiming agent's own turn end — a `SubagentStop`
firing, the one event that carries an `agent_id` — seals that agent as the
driver.

### The environment path never worked for the case it was needed in

ADR-0008 leaned on the environment because, at the time, nothing else was
available: a CLI process reads its own environment, and that was the only
handle on "who is asking". ADR-0010 then measured what a **delegated
agent** — a teammate under Claude Code's agent-teams feature, or a
subagent — actually looks like, and found the assumption underneath that
decision to be false in exactly the configuration headsign was being
stretched to cover. A delegated agent shares the spawning session's
process outright: same pid, same environment. Its environment contains the
*enclosing session's* identifier and no identifier of its own under any
name, so a `headsign next` run by such an agent stamped the session that
spawned it, silently and always. And its turn end does not fire `Stop` at
all, so the comparison that stamp fed never ran for it: the event that
would have run it does not happen for a delegated agent.

So of the two paths, only the claim path ever named a delegated agent, and
delegated agents are what the backstop is for once a run changes hands.
The environment path's remaining, genuine coverage was narrower than it
looked: two *separate* Claude Code sessions, each with its own session
identifier, open on the same run directory. That is the case this ADR
gives up, and it is weighed below.

### The `HEADSIGN_SESSION_ID` trap

The documented escape hatch was worse than unused — it was actively
harmful, and silently so. The CLI resolved `HEADSIGN_SESSION_ID` **first**,
ahead of `CLAUDE_CODE_SESSION_ID`, so exporting it made `start`/`next`
stamp the value the user chose. The `Stop` hook resolved the other way
around: it preferred the `session_id` on its own stdin and fell back to
`HEADSIGN_SESSION_ID` only when stdin carried none. Under Claude Code,
stdin always carries one. The two sides therefore disagreed permanently
and by construction, the owner match read that as a confirmed mismatch,
and the hook passed the driver's own stop through — every time, with no
output and nothing in the log.

The user who set the variable to make ownership *more* explicit thereby
turned off their own backstop. A knob whose documented use disables the
guarantee the tool exists to provide is not a knob worth keeping working;
this ADR removes it rather than repairing the precedence, because the
mechanism it belongs to is going too.

## Decision

### 1. One path: a driver is sealed by `SubagentStop`, or not at all

The environment is no longer consulted for identity. `resolveSessionId()`
and `resolveHookSessionId()` are deleted, and `cmdStart` and `cmdNext` lose
their stamping entirely. `start` writes `driver_agent: null` into the fresh
state and `next` never writes the field at all, so the adoption gate
ADR-0010 put in the `SubagentStop` hook is the only writer of a driver
identifier, and an `agent_id` delivered by that event is the only
identifier headsign records anywhere.

`src/session.ts` goes with the path that justified it. It existed to hold
identifier resolution and observer detection together (ADR-0008); what
survives is `isObserver()`, a single env lookup read by the two
stop-boundary hooks and nothing else, which does not earn a module boundary
of its own. It moves into `stophook.ts`, which holds both of them, and the
module count drops by one.

The two-beat claim procedure, the marker, the block that carries the
adoption's confirmation, and the gate's deliberate willingness to seat
whoever names itself first under an armed marker are all unchanged
(ADR-0010). This ADR removes a competing mechanism; it does not touch that
one.

### 2. `Stop` compares nothing

With no session identifier stored, `Stop` has nothing to compare and stops
reading identifiers at all — the stdin `session_id` field is not consulted,
and the type it parses stdin into no longer names it. Its order becomes:

1. `isObserver(env)` → pass, before stdin is parsed (ADR-0008).
2. Parse stdin; unparseable → pass (fail open).
3. `stop_hook_active` → pass.
4. Bounded walk-up for `.headsign/state.json`; not found → pass (ADR-0006).
5. Unreadable state, or `status !== "running"` → pass.
6. **`driver_agent` is non-null → pass.** What is stored is an agent id,
   and this event is a *session's* turn end, so this stop cannot be the
   driver's. This is ADR-0010's Decision 4 with its condition restated in
   terms of the one field that remains — the check keeps its place ahead of
   the exit-note gate, so an enclosing session's stop can never consume the
   driving agent's one-shot pause note.
7. Exit-note gate, then nudge / cap — both unchanged (ADR-0006).

Step 6 is a pass-through, so `Stop` still has exactly one branch that
blocks: the nudge. On a run nobody has claimed, that nudge is unconditional
for whatever session stops in the run's directory, which is precisely the
behavior headsign had before ownership existed, and the right one for the
ordinary case of a single session driving its own run.

### 3. `driver_session` becomes `driver_agent`; `driver_source` is deleted

The stored field is renamed because its old name is now a lie. The only
writer is the adoption gate, and what that gate writes is always an
`agent_id`; a session id can never land there again. `driver_agent` says
what is in the field, so a reader no longer needs a second field to find
out — which is why `driver_source` goes: one writer means one identifier
space, and there is nothing left to discriminate between. ADR-0010's
Decision 2 answered a question that no longer exists.

No compatibility is provided for a `state.json` holding the old field
(`claim` and the fields around it shipped in 0.2.0, so this is a breaking
change, recorded as one in the changelog). Readers must still be tolerant
in the ordinary way, and one detail is load-bearing: a legacy state.json
reads back as `undefined`, not `null`, so a bare `x !== null` test would
treat an unclaimed run as claimed. Readers check for a non-empty string
instead.

### 4. `status`'s `driver:` line has two values

The line ADR-0008 introduced stays, and shrinks to what can still be known:

| State | `driver:` reads |
|---|---|
| `driver_agent` non-null | `a delegated agent` |
| `driver_agent` null | `not delegated yet — no agent has claimed this run` |

Everything the old line said about *this session* is gone with the
comparison that produced it: `status` never resolved an agent identifier,
only a session one, and there is no longer a session identifier on file to
compare it against.

The line is kept rather than dropped because `claim` is a two-beat
procedure that can fail quietly — the agent ended its turn without the
marker being sealed, or another delegated agent named itself first — and a
single `headsign status` is how anyone confirms that the handoff actually
landed. That is the whole of its remaining job, and the two values say
exactly it.

### 5. The sticky rule is deleted with the mechanism it guarded

ADR-0009 made a claimed driver *sticky*: `next`'s auto-stamp refused to
overwrite a `driver_source` of `"claim"`, so an unrelated `next` from the
shared environment could not silently reclaim a seat a delegated agent had
been given. There is no auto-stamp any more, so there is nothing to be
immune to. The rule is removed rather than restated: it is not that claimed
ownership is now unprotected, it is that the only writer left is the one
the rule existed to protect. Code, comments and documentation carry no
"sticky" concept from here on.

## What this gives up

**Two sessions on one run directory are no longer told apart.** Under the
environment stamp, a second Claude Code session that stopped in a run's
directory resolved its own session id, disagreed with the stamp, and passed
untouched. Now nothing is stamped until a delegated agent claims the run,
so on an unclaimed run every session that ends a turn there is nudged, and
each of those nudges spends one from the shared cap ADR-0008 was written to
protect. That protection is not lost across the board — once a run *is*
claimed, step 6 above passes every session unconditionally, which is
stronger than the old comparison, since it needs no identifier to resolve
on either side — but between `start` and a claim it is gone.

Two things make that acceptable. First, the configuration it degrades is
one headsign already declines to support: resolution is cwd-only and a run
belongs to one directory, so **one worktree, one run** is the model, and
two sessions driving the same directory are outside it (ADR-0004). Second,
the manual opt-out survives and is now the only control: a session that
knows it is only watching sets `HEADSIGN_OBSERVER` and is passed before
stdin is even parsed. ADR-0008 called that the insurance policy; it is now
load-bearing rather than supplementary, and the documentation says so.

**The identity path is now Claude Code-specific, with no fallback.** It
rests entirely on two behaviors of one harness: that a delegated agent's
turn end fires `SubagentStop`, and that the payload carries an `agent_id`
(undocumented, as ADR-0010 named). If either changes, no run ever acquires
a driver — there is no second path to degrade into any more, because this
ADR removed it.

The degradation is still quiet and safe, and it is worth being exact about
who feels it, because the two hooks answer an unclaimed run in opposite
directions: `Stop` nudges every session that stops in the run's directory,
while `SubagentStop` requires a positive match and therefore holds no
delegated agent at all. So a lone session keeps its backstop intact — that
is the ordinary case, and an unstamped run always served it correctly —
while delegated agents lose theirs, exactly as ADR-0010 said they would if
`agent_id` went away.

A harness that gives every agent its own process could in principle name
its agents through the environment, and this ADR deliberately gives up the
ability to read that. The consolation is narrow but real: the hooks are
themselves a Claude Code interface, so a harness that cannot deliver
`SubagentStop` has no stop-boundary backstop to lose in the first place.
Everything else headsign does — gates, transitions, state, `status` — never
asked who was calling and is unaffected.

## Consequences

- headsign reads no session identifier from anywhere. `HEADSIGN_SESSION_ID`
  is gone as a supported variable, `CLAUDE_CODE_SESSION_ID` is no longer
  read, and `HEADSIGN_OBSERVER` is the only environment variable the tool
  consults.
- `state.json` holds one ownership field, `driver_agent`, written by one
  hook. A run's ownership therefore changes at exactly one moment: a
  delegated agent's turn end under an armed claim marker.
- `start` and `next` write nothing about ownership, and a `PENDING` answer
  now touches `state.json` on no path at all: the driver refresh was the
  one write that could still happen there, on a `next` whose resolved
  identifier differed from the stamp on file.
- One of the two identity mechanisms `architecture.md` warned about is
  gone. That file's note — that a proposal adding a third should be
  answered by consolidating the first two — has been taken up rather than
  merely repeated.
- The `claimed` log line, the marker, the confirmation message, and the
  race ADR-0010 named honestly are all unchanged. Re-claiming until the
  confirmation names the agent you meant is still the operator's
  instruction.
