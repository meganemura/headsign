# ADR-0027: Recording who drove a run

- Status: accepted
- Date: 2026-08-01
- Supersedes [ADR-0013](0013-claim-only-driver-identity.md): the clause of
  its one-path decision making an `agent_id`
  "the only identifier headsign records anywhere", and its "`Stop` compares
  nothing" decision entirely.
- Stands, and is the answer to the objection this ADR had to clear: the
  `SubagentStop` adoption gate remains **the only writer of a driver
  identifier**. `last_drive` records who ran a command, not who drives, so there
  is still exactly one path to a driver.
- Amends [ADR-0006](0006-stop-hook-backstop.md): "a PENDING answer touches
  nothing on disk" narrows to
  "changes nothing about the run's progress".
- Revised: 2026-08-02 (§9 below. The §3 comparison governs the
  `CLAUDE_PROJECT_DIR` fallback of [ADR-0026](0026-a-second-place-to-look.md)
  as well, which the Decision as first written left reading only the claim;
  "What this gives up" therefore names two lost `unheld` lines rather than
  one. Nothing above is retracted and no text above is edited — §9 sets out
  why the extension follows from §3 rather than adding to it.)

## Context

headsign nudges whoever ends a turn in the directory of a run nobody has
claimed, because it has no way to tell one party from another. A program that
starts Claude Code as a subprocess inside such a repository gets a session
standing in the run's directory; that session is nudged, cannot act, corrupts
its own output trying to, and spends the run's shared backstop budget while
the actual driver — who never ended a turn there — is left with none.

Fixing that needs headsign to know who has acted on the run. A mechanism
doing exactly that existed once, and was removed by
[ADR-0013](0013-claim-only-driver-identity.md), whose first decision is
titled "One path: a driver is sealed by `SubagentStop`, or not at all."
Before anything below could be decided, that title had to be read as an
objection: does bringing session identity back on the `Stop` side put a
second path to a driver next to the one `SubagentStop` already owns?

**It does not, and that is the header of this record: the fix below does not
add a second path to a driver.**

## Decision

### 1. The ordinary case does not change

Lead with the case nearly every run is in. One session starts a run and
drives it alone from `start` to `COMPLETE` or `ESCALATE`. That session is
stamped at `start`, re-stamped on every `next`, matches on every turn end,
and is nudged exactly as it is today. Nothing below touches that
arrangement. Everything that follows concerns two other parties: a
**handover**, a run continued from a session other than the one that began
it, and a **bystander**, any session — human or a program's subprocess —
that ends a turn in a run's directory without ever having run a headsign
command against that run.

### 2. What ADR-0013 removed: two writers of one field, not two paths

The two failures ADR-0013 names for the environment-derived stamp it
retired are both internal to that one mechanism, not evidence against
identity as such. The **trap**: the CLI resolved `HEADSIGN_SESSION_ID`
first and the hook resolved it last, so the two sides disagreed
permanently and by construction, and the driver's own stop passed through
silently — one mechanism, two sources. The **wrong grain**: a delegated
agent shares its spawning session's process, so the stamp always named the
enclosing session whenever such an agent ran `next` — one mechanism, naming
the wrong thing. The claim path, sealed by `SubagentStop`, is nowhere in
either story; it is the thing that worked.

**But the two writers did collide, and the record of the prevention is in a
different ADR than the one that removed them.** [ADR-0009](0009-claim-handshake.md)'s
"Claimed ownership is sticky" gave the old stamp's auto-write on `next` an
extra condition — overwrite only when the field naming who wrote it was not
`"claim"` — because otherwise the next teammate's ordinary `next` call,
resolved from the same shared environment, could silently un-claim a seat a
delegated agent had just been given. Two writers of one field needed a rule
about who may overwrite whom, and the failure that rule guarded against was
silent. That is the real weight of "one path": not a bookkeeping field
going away, but a silent write-ordering hazard going away.

Three requirements follow, and they are not of equal size:

1. **One source for the stamp.** Measured directly, inside a real hook
   invocation, 2026-08-01: the environment's `CLAUDE_CODE_SESSION_ID` and
   the hook payload's `session_id` are the same string for a session's own
   turn end. `CLAUDE_PID` was measured too, and rejected — it is not stable
   across a session's lifetime, so it cannot anchor a comparison meant to
   hold from `start` to a `Stop` that may happen much later. A delegated
   agent's turn end resolves a distinct uuid for the same environment
   variable, which is the wrong-grain problem restated, not a new one.
2. **Its own field, never shared with the claim.** Neither writer can
   overwrite the other if they never write the same place, which removes
   the hazard ADR-0009 had to manage with a rule, rather than reproducing
   it.
3. **Read only where naming a session is correct** — by `Stop`, a
   session's own turn end. This is permanent, not a preference: a
   delegated agent still shares its session's environment, so a session id
   resolved inside one still names the enclosing session. Nothing may read
   the stamp on an agent's behalf.

**One cost cannot be recovered.** [ADR-0009](0009-claim-handshake.md) also
removed `status`'s "this session / another session" answer, because the
environment resolution behind it would just as happily mis-judge `status`'s
own "is it me" question. A session stamp does not bring that bug back —
`Stop` compares a payload against a record, it never resolves its own
identity — but it cannot restore that answer either, because `status` has
only the environment to ask with. Nothing `status` prints about a stamped
run may say "and it is you".

### 3. The stamp and the claim, and where the new check sits

`Stop` already reads the claim: if the run has a recorded driver, it
returns without a word, since a driver is an agent id and `Stop` is a
session's turn end. So the stamp and the claim are not disjoint — both
would be consulted on the same `Stop` — but they meet in an order that
already exists rather than one invented here: the claim check returns
above anything the stamp would be read at, so **a claim being present makes
the stamp unreachable.** It cannot be weighed against the claim, contradict
it, or need arbitrating, and `SubagentStop` reads the claim only, never the
stamp, for the reason in §2.3.

**Consequence, stated without inflation: a claimed run is unchanged, byte
for byte**, because the stamp comparison is never reached for one. The
phrase [ADR-0026](0026-a-second-place-to-look.md) uses for its own
fallback walk — "every case that has an answer today gets the same
answer" — does **not** apply to this design as a whole. That guarantee was
earned there only on a branch that wrote nothing; this design exists
specifically to change the answer on runs nobody has claimed.

**One of those changes is a decision, not a detail, and this ADR makes it:
the new comparison is checked above the already-continuing flag
(`stop_hook_active`), not below it.** `src/stophook.ts` already lowers that
flag's check past three reads — the record read, the status test, the
recorded-driver test — with the stated reason that "everything it now
passes over is read-only … so moving it down spends nothing … and still
blocks nothing." A comparison against `last_drive.session` is exactly that
kind of read: on a mismatch it writes nothing and blocks nothing, so
placing it above the flag preserves the same invariant the flag's own
position already relies on, rather than adding an exception to it. Placed
below the flag instead, a bystander's flagged turn end would still write
`unheld by=stop_hook_active` into a run's log and `last_stop` before the
mismatch was ever read — the record this design exists to stop handing to
parties that never drove the run. Above the flag, that write does not
happen: a bystander's turn end, flagged or not, leaves the run's record
untouched.

`Stop`'s order becomes, extending [ADR-0013](0013-claim-only-driver-identity.md)'s
own numbered list:

1. `isObserver(env)` → pass.
2. Parse stdin; unparseable → pass.
3. Bounded walk-up for `.headsign/state.json` (with the
   `CLAUDE_PROJECT_DIR` fallback of [ADR-0026](0026-a-second-place-to-look.md));
   not found → pass.
4. Unreadable state, or `status !== "running"` → pass.
5. `driver_agent` is non-null → pass (a claimed run; the stamp below is
   unreachable).
6. **New: `last_drive` holds a session AND the payload's `session_id` does
   not match it → pass, silently, writing nothing.** This turn end did not
   come from the session that most recently drove this run.

   The first half of that condition is load-bearing and must not be
   simplified away. A run with **no** `last_drive` — one started by an
   earlier headsign, or one whose state a person edited — falls through to
   the nudge, exactly as today. Reading "no stamp" as "no match" would turn
   every run in flight at upgrade time silently unbackstopped, which is
   precisely the failure this project's own rule forbids: never let a value
   decide whether headsign's records are right while headsign still appears
   to be working. Absent means *unknown*, and unknown falls back to the
   fail-open default ADR-0006 chose — the same tolerant-reader idiom
   `driver_agent` already uses, where anything that is not a non-empty
   string reads as "nobody has claimed this".
7. `stop_hook_active` → record `unheld by=stop_hook_active`, pass.
8. Exit-note gate, then nudge / cap — unchanged.

`SubagentStop` is untouched by this section: it reads the claim marker
only, exactly as [ADR-0010](0010-subagent-stop-identity.md) left it, and
never reads `last_drive`.

### 4. Its own field, named for the act: `last_drive: { session, at }`

Reusing `driver_agent` was considered and disqualified twice. It rebuilds
the collision hazard §2 removed — two writers sharing one field is what
ADR-0009 had to manage with a stickiness rule, and what ADR-0013 removed
`driver_source` to end ("one writer means one identifier space, and there
is nothing left to discriminate between"). And the name would lie again:
ADR-0013 renamed `driver_session` to `driver_agent` because "its old name
is now a lie"; writing a session id there would re-tell that lie in the
other direction.

The new field is `last_drive: { session, at }`, beside `last_stop`, not
inside it. `at` is not a later convenience: whether an old stamp on a
long-handed-off run should be treated differently from a fresh one is a
real question, and it cannot even be asked without a timestamp.

The naming choice follows a pattern already in `state.json` rather than
setting a new one. Every field there is named for a count (`attempts`,
`stop_nudges`), an event (`last_failure`, `last_stop`), or what the run
*is* (`workflow`, `phase`, `status`) — except `driver_agent`, named for a
role, which is also the only field whose name has ever had to change
because it started lying. `last_drive` names the act, in the project's own
verb ("a driving session"). It stays true on a claimed run, where it
simply stops being read, rather than needing to be repaired later.

None of this touches the claim path. The two-beat claim handshake, the
`SubagentStop` adoption gate, the positive-match rule, the observer
opt-out, and `driver_agent` itself are all unchanged by this ADR.

### 5. `start` and every `next` write it, every time they run

Stamping only at `start` is wrong for a case that is not an edge case: a
run outlives the session that began it. Somebody starts one, that session
ends, a fresh session opens and continues with `next`. Stamped only at
`start`, the afternoon session never matches, and the backstop switches
itself off — silently — for the most ordinary continuation there is.

Stamping cannot simply ride along with `next`'s state write, because two of
its paths deliberately write no state at all: **PENDING**, when a `ready:`
probe has not passed, and the global ceiling, which answers `ESCALATE`
without ending the run. PENDING is not an edge case either — it is the
normal answer while a review runs, exactly the stretch in which somebody
walks away, and exactly what the backstop exists to cover. A stamp that
skipped PENDING would switch the backstop off during the one wait it was
built for.

So the rule is one sentence: **the two commands a driver runs — `start` and
`next` — record who ran them, every time they are run.** That covers
PENDING and the ceiling without an exception list. The lock those paths
already hold covers the stamp write too, so nothing new is contended.

This narrows a statement [ADR-0006](0006-stop-hook-backstop.md) makes about
PENDING, which is the amendment named in this ADR's header. What PENDING
and the ceiling protect is the requirement that a PENDING answer must not
reset `stop_nudges`. Writing `last_drive` touches no counter and no phase,
so "a PENDING answer touches nothing on disk" narrows to "a PENDING answer
changes nothing about the run's **progress**" — the guarantee ADR-0006
actually needs survives; only its literal wording about the disk does not.

`abort` does not stamp: both hooks return early on a non-running run, so
stamping there writes for no reader. `claim` never touches `state.json` at
all — it arms a marker under `tmp/`. `status` and `validate` must not write.

### 6. A session that has not run `next` is not nudged

Nudging on a mismatch instead of passing silently would give the whole
design away: the hook cannot tell a driver-to-be, mid-handover, from a
subprocess that will never touch the run — both are simply "not the
stamped party" at the moment they stop. Nudging either would be today's
behavior with extra steps, and the stamp would buy nothing.

**Two costs follow, and they are different kinds.** A driver mid-handover
loses the backstop — not for one turn, but for every turn until its first
`next`. That gap is real, but the project's own workflow-authoring
instruction already tells a session that did not start the run and was not
asked to continue it **not** to run `next`, because "obeying a nudge you
weren't meant to answer can burn a retry or advance a phase nobody asked
you to touch." So the hook not nudging an untouched session is it agreeing
with an instruction the project already gives, rather than weakening a
guarantee — and that instruction's own warning exists precisely because
today's nudge reaches parties that should not answer it, so it can soften
once it stops reaching them.

The other cost is discovery, not backstop, and it is a different kind of
loss entirely: today a session opening on a repository with a run finds
out by being nudged, a side effect of nudging everyone nearby rather than
the backstop's actual job. Its replacement is `headsign status`,
read-only and safe to run from anywhere, which the reference material
already sends every non-driving session to.

**What bounds the gap:** `start` stamps, so the unstamped window never
exists for the session that begins a run — only for a second session that
picks one up, and only until that session's own first headsign command.

### 7. `status` gains one line: the time and the consequence

```
last moved: 2026-08-01T19:45:29+09:00 — turn ends from any other session pass without a nudge
```

Conditional, printed only once `last_drive` exists, the same way `last
stop:`, the graph-change lines, and `observer:` already are — a run on
which nothing has happened prints exactly what it prints today.

`status` already prints one timestamp, `last stop: … — at <ts>`, so this is
not adding a clock to a command that had none. It is that one timestamp
cannot separate two situations that call for different reactions, and two
can: `last_stop.at` is when a turn end was last *attributed*, `last_drive.at`
is when the run was last *moved*. A run stopped at repeatedly while never
advancing has a fresh stop and a stale move; a run nobody has touched has
both stale.

Two wording choices are forced by what is already on screen. The label is
`last moved:`, not `last drive:` — the latter would print directly under
`driver:`, which is about the claim handshake and unrelated, and a reader
would take one as explaining the other; nothing requires the line to echo
the field's own name. And the consequence reads "pass without a nudge",
never "pass unheld" — `unheld` is a logged disposition with a `by=` detail,
and whether a mismatched stop writes anything at all is an implementation
question this ADR leaves open on purpose.

**Never printed:** the identifier itself, and no claim about whether the
reader is the stamped session — for the reason given in §2, `status` has
only the environment to ask with, and cannot answer "is it me" honestly.

### 8. One decision retracted in full, one narrowed, one amended elsewhere

ADR-0013's first decision says two separate things: the adoption gate is
*the only writer of a driver identifier*, and an `agent_id` is *the only
identifier headsign records anywhere*. **Only the second is retracted.**
`last_drive` records who ran a command, not who drives — that is what §4's
naming settles — so nothing writes a driver identifier except the adoption
gate, before or after this ADR. There is still exactly one path to a
driver. ADR-0013's second decision, "`Stop` compares nothing," is retracted
in full: `Stop` now compares one thing, and it is not a driver identifier.

This is a **new ADR**, not an amendment to ADR-0013 itself, because the
project's own convention is to retract by superseding and to extend or
qualify by amending, and this record does both to different targets: it
retracts part of ADR-0013 and amends ADR-0006. ADR-0013 keeps its own text
unedited and gains a dated `Revised:` line, the way ADR-0008's does — the
history that made this round possible has to survive for the next reader to
find the same way this round did.

### 9. The same comparison governs the second starting point

Everything above describes the walk up from the session's own directory.
[ADR-0026](0026-a-second-place-to-look.md) gave `Stop` a second one — a run
found from `CLAUDE_PROJECT_DIR` when that walk finds nothing — on which it
writes `unheld by=CLAUDE_PROJECT_DIR` and returns without holding. §3's
ordered list passes over that path in a single parenthesis, and the Decision
as first written left it testing only the claim. **It tests the stamp too.**

That is not a second decision, and the code says so before this record does.
`src/stophook.ts` states the rule the fallback is built on in its own words:
the test it applies "mirrors the test each [hook] already runs on the
ordinary path below." That is an invariant, not a coincidence — and §3
changed what `Stop`'s ordinary path tests. A fallback left testing only the
claim would not be a narrower policy arrived at on purpose; it would be a
mirror that had quietly stopped matching, which is the exact failure the
sentence was written to prevent.

The reason is also one §3 has already given. A bystander's flagged turn end
is kept from writing `unheld by=stop_hook_active` because that is "the
record this design exists to stop handing to parties that never drove the
run." `unheld by=CLAUDE_PROJECT_DIR` is the same kind of record, written by
the same function, about the same party, onto the same run. There is no
reading on which one of the two is a record a bystander may leave behind and
the other is not.

What the extension costs is nothing the ordinary path does not already cost,
and what it protects is precisely the population ADR-0026 built the fallback
for. A driver whose session had wandered out of the run's tree ran `start`
or `next` and is therefore stamped, so it matches and its line is still
written. A run with no stamp on record still attributes, by the same
fail-open rule as everywhere else in this ADR. Only a session that never
moved the run loses the line — and it now loses it on both paths rather than
one, which is the whole of the change.

`SubagentStop`'s half of the fallback is untouched, for the reason in §2.3:
it already demands a positive match against the recorded driver, and it
still never reads `last_drive`.

**A correction to "What this gives up", which named one lost line where
there are two.** Both are `unheld` records a bystander used to leave on a
run it never drove and no longer does. The list below is left as it was
written; this paragraph is the amendment to it, and the count is two.

## Rejected

- **Reusing `driver_agent`** for the stamp (§4).
- **Nudging on a session-id mismatch**, which would make the stamp buy
  nothing new (§6).
- **Telling `status` whether the stamped session is the one reading it** —
  it cannot know, for the same reason ADR-0009 removed that answer (§2, §7).
- **Printing or logging the identifier itself**, anywhere.
- **Touching the claim path.** The handshake, the adoption gate, the
  positive-match rule, and the observer opt-out all stand exactly as
  ADR-0009 and ADR-0010 left them.
- **Deciding whether a session standing in a checkout other than the one it
  is neglecting should be pointed at that run.** Left open; out of scope
  here.

## What this gives up

- **A backstop gap during a handover**, bounded by a fresh session's own
  first `next` rather than by one turn (§6).
- **Automatic discovery of a nearby run**, replaced by `headsign status`
  rather than a side effect of being nudged (§6).
- **A bystander's flagged turn end no longer writes `unheld
  by=stop_hook_active`** on an unclaimed run once this session was never
  its driver — a direct, deliberate consequence of placing the new
  comparison above the already-continuing flag (§3).
- Nothing about a **claimed** run: it is unchanged, byte for byte (§3).

## Consequences

- `state.json` gains `last_drive: { session, at }`, written beside
  `last_stop` under the run's existing lock, never inside the object it
  sits beside.
- `start` and every `next` that reaches the run write it, PENDING and the
  global ceiling included; `abort`, `claim`, `status`, and `validate` do
  not.
- `Stop` gains one new, read-only comparison, placed above the
  already-continuing flag and below the claim check; `SubagentStop` gains
  none.
- `status` gains one conditional line, `last moved:`, printed beside `last
  stop:`, naming neither an identifier nor a claim about the reader.
- ADR-0013 gains a dated `Revised:` line recording exactly what is
  retracted and what stands; its own text is not edited.
- Follow-on work, not done by this ADR: `src/state.ts`, `src/cli.ts` /
  `src/engine.ts`, `src/stophook.ts`, and `src/render.ts` need the changes
  above implemented; the reference manual, the workflow-authoring skill,
  and the diagnostic checklist all need "the run was last moved by someone
  else" added to the list of ways a turn ends without a word, and need the
  now-false claim that a run announces itself to whoever stops in its
  directory removed.
