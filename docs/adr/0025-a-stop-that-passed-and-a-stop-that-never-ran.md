# ADR-0025: Telling a stop that passed from a hook that never ran

- Status: accepted
- Date: 2026-07-30
- Amends [ADR-0004](0004-state-attempts-and-cache.md): the log gains a twelfth
  event word, `unheld`, and `state.json` gains a `last_stop` field.
- Revised: 2026-07-31 — §7 is **retracted**. Nudges are logged after all, as a
  `held` event, and ADR-0004's spam-prevention rule is amended a second time.
  The retraction notice sits above the original text, which is kept: the section
  named the cost, accepted it, and was wrong, and being able to read the wrong
  weighing is worth more than a clean rewrite.
- Amends [ADR-0006](0006-stop-hook-backstop.md): the `stop_hook_active` check
  stops being a bare early return and gains a body; the record now says how the
  last stop was handled; and the section on the nudge cap gains what the flag
  does to its arithmetic.
- Amends [ADR-0002](0002-single-question-and-output-contract.md): `status` grows
  two conditional lines.
- Amends [ADR-0008](0008-multi-session-ownership.md): `HEADSIGN_OBSERVER` becomes
  reportable by `status`, while the hook path it governs stays a complete no-op.

## Context

A project using headsign drove a run several phases per turn and noticed the
nudge appearing only on alternate turn endings. The cause is ordinary and the
behaviour is right: Claude Code sets `stop_hook_active` on a stop hook's input
once a stop hook has held that turn, and headsign passes such a stop through.

What made it a report is the shape of the silence. **The pass writes nothing —
not a log line, not a field, not a word in `status`.** So the driver could not
distinguish two situations that call for opposite responses:

- the hook ran, found the flag, and stood down; or
- the hook is not installed, or is not firing at all.

The first needs nothing. The second is a broken setup. Documentation cannot tell
them apart, because the question is about this machine right now rather than
about the design. Only a mark the hook left behind can answer it, and there was
none. The driver went to inspect their hook registration and plugin layout, which
is exactly the wasted work an observable pass would have prevented.

On the way there they read `"stop_nudges": 0` out of the run record and concluded
the nudge cap was not the cause. That inference was sound and the field was not:

- it is never incremented by a flagged pass, so it cannot answer the question
  they were asking; and
- `step()` resets it to 0 unconditionally on every real gate evaluation, so while
  a run is being driven it reads 0 or 1 and nothing else.

Their own summary is the sharpest statement of the problem: the documentation
lists four reasons a turn can end quietly, the record exposes exactly one of
them, and that one was not their cause.

## Decision

### 1. One new log event, for exactly one situation

Every point at which either hook lets a stop through was enumerated. All but two
already leave a trace: the pause note has `paused`, the exhausted cap has
`stalled`, a bystander's pass is covered by the driver's `claimed` line and by
`status`'s `driver:` line, and observer / unparseable input / no run found /
vanished record are all "headsign has no run in hand". The flagged pass is the one
with nothing behind it anywhere, and it gets the one new line:

```
2026-07-30T23:06:51+09:00 unheld decide a=0 i=21 by=stop_hook_active
```

This does not reopen "log everything the hook does" (ADR-0004's phrase). It
applies that ADR's own admission criterion — each stop-boundary event is logged
because it "is the only trace its own kind of Stop-boundary event otherwise leaves
behind" — to a case its authors had not met. Of the log's eleven existing event
words, six mark a run moving and five do not, and every one of the five was
admitted on that ground or the neighbouring one ADR-0004 uses for `ceiling`: "it
is logged anyway, because … nothing else records it."

**The second traceless case is not being closed.** A stop that passes because the
run's lock was held usually has the concurrent lap's own line as its trace — but a
lap answering `PENDING` writes neither state nor log (deliberately, per ADR-0004),
so that combination leaves nothing. Recording it would mean writing with counters
read *before* the lock, about a run another process is part-way through changing:
a line stamped now and counted then. The gap is documented instead.

### 2. The event word is `unheld`, and the mechanism is not called a loop guard

Two names that suggest themselves are already taken, and using either would make
the log worse at the one job this ADR exists to give it.

**`pass` is unavailable.** It is headsign's own token for a gate succeeding —
`GateVerdict`'s passing arm is named `pass` and `engine.ts` branches on
`gateResult.kind === "pass"`. A `pass` event word would be that same string, in a
file whose other lines record exactly that, for the opposite kind of event.

**"Loop guard" must not name Claude Code's flag.** That is headsign's name for
`stop_nudges`: this ADR's own section heading, the branch label in `stophook.ts`,
the comment in `engine.ts`. The two are sibling mechanisms at the same boundary
producing the same observable outcome — a stop that passes quietly — and telling
the exhausted cap from the platform's flag is precisely the discrimination a reader
of two silent stops needs. One name for both removes it. This is the error avoided
when the iteration ceiling was refused the word `escalate`, on the grounds that
reusing it "would let a reader take a log that stops here for a log of a run that
ended".

So: the event word is **`unheld`**, the negation of the verb headsign's own
documentation already uses for what the hook does to a turn ("holds an agent when
it matches the recorded driver", "Being held there says the run is running"). It
carries no suggestion that headsign chose to let go — it did not, it was overruled.
Claude Code's mechanism is **the already-continuing flag**, from the gloss this ADR
already records for the field ("Claude is already continuing as a result of a stop
hook").

### 3. The upstream field is named in the detail, bare

`by=stop_hook_active`, unquoted. The log line's grammar already separates the two
registers: the event word slot holds headsign's own chosen words, while the detail
carries names from outside — `check="…"` and `routed-when="…"` from the workflow
author, `reason="…"` and `note="…"` from a human. And the quoting rule is stated in
`render.ts` where the graph-change line writes phase keys: bare because "they are
identifiers … not free text like a reason". `stop_hook_active` is an identifier.

Naming a foreign field is deliberate. The chain a person follows to diagnose this
runs from the log line, through headsign's source, to the hook payload they can
print, to whatever upstream documentation exists, and that token is the single link
common to all four. A paraphrase breaks it at the first step — and reading
`if (input.stop_hook_active)` in the source is how the reporter found the cause.

The risk of naming something headsign does not own is **not** that the name rots. If
the field disappears, the branch stops firing and no new line carries it; old lines
keep it, which is what a log is for. The risk is that a reader takes it for something
headsign controls. That is what the documentation sentence is for, and that sentence
has one rule: **describe what headsign does with the field, never assert what
upstream's documentation currently says.** This ADR's own dated line about the field
no longer being documented is the example of why — a published claim about somebody
else's documentation rots silently.

### 4. `state.json` gains `last_stop`, written with the line

```json
"last_stop": { "disposition": "nudged" | "unheld" | "paused" | "stalled", "at": "<local ISO>" }
```

Written **in the same `withRunLock` call as the log append**. That is what makes a
field and a line safe to keep together: `withRunLock` writes the record and appends
the line in one locked operation, so both land or neither does. It is the shape
`paused` already uses.

This is a second representation of one event, and that is the house pattern rather
than a smell. Every stop-boundary and graph event already has both forms — `claimed`
with `driver_agent`, `paused` with the `stop_nudges` reset, `stalled` with
`stop_nudges: 5`, `graph-changed` with `graph_change_reported` and
`accepted_graph_changes`. The log holds the event; the record holds the current
value; ADR-0004 calls `state.json` "the external memory".

**Written on every stop the hook processes and can attribute** — a nudge, an
`unheld` pass, a pause, and the pass that happens because the cap is spent. This is
the load-bearing part, and it is the lesson of the field that misled the reporter: a
value written only on passes would still read "not held at 23:06:51" long after a
later nudge, and a reader would take a stale value for a current one. Writing it at
every disposition is what keeps it about *now*.

One boundary is worth stating because the log line and the field disagree there, and
only there. The nudge that *trips* the cap gets the disposition `nudged`, not
`stalled`: that stop was held, and `stalled`'s wording ("not held") would be false
about it. `stalled` begins at the stop after it — the first one the spent cap lets
through. The two records answer different questions — the line says when the guard
tripped, the field says what happened to the most recent turn end — and this is the
one stop where those answers differ.

**Not written** where headsign cannot attribute the stop or cannot write at all:
`HEADSIGN_OBSERVER`, unparseable input, no run found, a run that is not `running`, a
bystander's stop, or a held lock. So the field is stale after a bystander's turn
end — the same limit `status`'s `driver:` line carries, and it gets the same
treatment: print it, document the limit.

Two record writes appear on paths that write nothing today, the flagged pass and the
cap-spent pass, at roughly one per exchange — the same order as `next`'s own per-lap
write. Both keep the existing fail-open behaviour: if the lock cannot be taken,
nothing changes and the turn ends.

**Rejected: a marker file** in `.headsign/tmp/`. Cheaper than a record field — one
overwrite, no lock, no schema, no tolerant read — and refused because `tmp/` is
defined in ADR-0004 as "scratch space for the workflow, not headsign-internal state
the way `state.json` and `lock` are".

**Rejected: teaching `status` to read the log.** ADR-0024 made this cheaper than it
looks — it declared the line format machine-usable, committed to the invariants that
make an anchored match safe, and published the pipeline that slices the current run
out of a multi-run file. What refuses it is narrower: `engine.ts` parsing the log
would make headsign depend on its own output format internally, so a format change
would break the program rather than a user's `grep`, and the parser's only sensible
home is `render.ts`, whose responsibility is one-directional ("outcome -> text").
With the field in place, none of that is needed.

### 5. The flagged check keeps its guarantees and gains a body

For the line to name a phase and belong to the right party, the check must see the
record. Today it cannot: in `Stop` it runs before the record is read, and in
`SubagentStop` before the run has even been located.

Two guarantees must survive, and one action violates both at once — which is why it
governs the design rather than being a third item in a list. Consuming
`.headsign/tmp/claim` seats a driver **and** blocks.

1. A flagged turn end is **never blocked**.
2. It **never spends a one-shot resource** (the pause note).

**In `Stop`, the check moves down**, to immediately above the nudge flow. Everything
it now passes over is read-only — read the record, test the status, test for a
recorded driver — and the pause note is opened only inside the nudge flow. It then
knows the phase, and knows the run is unclaimed, because a claimed run returned one
step earlier.

**In `SubagentStop`, the check does not move past the adoption gate.** That gate
consumes the marker and blocks, and its position is itself decided: ADR-0010 requires
it to precede the owner comparison, "otherwise a just-claiming agent that doesn't yet
match the (possibly stale, possibly wrong) old driver would be passed through as an
unrelated bystander instead of adopted". The check gets its own branch instead, after
the record is read and before the `agent_id` resolution and the adoption gate:
resolve the id, compare it against the recorded driver, record only on a positive
match, and return.

The safety comes from **returning before the gate is in its path**, not from sitting
above it. A position can be undone by a later reordering; a return cannot.

The asymmetry is consistent with ADR-0010 rather than an exception to it. What that
ADR requires identical is *observable* behaviour, and both hooks here record an
`unheld` stop under the same condition, write the same line, and block nothing.
ADR-0010 itself says the two share "everything below the adoption gate", which
concedes that above it they do not.

What this costs is less than it appears. A bystander subagent's *unflagged* stop
already pays the walk-up, the record read, the agent-id resolution and the driver
comparison before returning having done nothing; this makes a flagged stop cost what
an unflagged one already costs. The genuinely new cost is one walk-up for a flagged
subagent stop in a repository with no run at all, where the hook pays nothing today —
so ADR-0006's "sessions not using headsign must pay nothing" survives in substance,
with "nothing" becoming "almost nothing".

### 6. `status` grows two conditional lines

```
RUNNING decide (attempt 0/5)
workflow: design-grilling
driver: not delegated yet — no agent has claimed this run
last stop: not held — Claude Code had already resumed the turn (stop_hook_active) — at 2026-07-30T23:06:51+09:00
```

with the other dispositions reading `held, and pointed back to headsign next`,
`paused by a note`, and `not held — the nudge cap is spent`. A record with no
`last_stop` prints no such line, so output is byte-identical to today until a stop
has been processed. The stored timestamp is printed verbatim: `render.ts` reads no
clock and cannot know the reader's timezone, and the value already carries its offset.

The objection this line has to answer is that it reports a fact about a party the CLI
cannot name, where a reader will assume it is about them — the same species of error
`stop_nudges: 0` produced. It does not survive the check's new position. From
`SubagentStop` the pass belongs to the driver by positive match; from `Stop` it
belongs to a session stopping on a run nobody has claimed, which is the party the hook
would otherwise have nudged. The residual case is two sessions open on one unclaimed
run, an ambiguity already documented for the nudge itself: "while nobody has claimed
it, every session in the directory is nudged, driver or not." And `driver:` is the
standing precedent for printing a party-related fact together with a written limit.

**The observer switch is also reported**, when it is set in the calling environment:

```
observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held
```

Of the five reasons a turn can end quietly, this is the only one a caller can answer
*about itself*, with no identifier to resolve — which makes it the cheapest honest
diagnostic available. Two qualifications go with it. What is read is the environment
of the process `status` runs in, normally the session's but not necessarily. And
nothing in headsign outside the hook path reads the environment today, so `status`
takes it as an argument, following `stophook.ts`'s "Nothing here reads the clock or
the environment: both arrive as arguments".

**The hook's observer path stays a complete no-op.** Writing there would undo the
short-circuit that makes the opt-out an opt-out — `isObserver(env)` runs before the
input is parsed and before the walk-up, so logging would require the whole body of the
hook — and it would record a non-participant in the record of a run it opted out of.

**Rejected: warning at `headsign start` when the switch is set.** Better targeted in
principle, since it fires when the contradiction is created. Refused because the
configuration is *correct*: a lead session that sets `HEADSIGN_OBSERVER`, runs `start`,
and delegates driving to an agent that runs `claim` is the arrangement ADR-0010 exists
to support. A warning on the recommended setup teaches people to ignore warnings.

### 7. Nudges 1–4 stay silent — **retracted 2026-07-31**

> **Retracted by field use, one day after this ADR was accepted.** The section
> below is kept verbatim, because what it got wrong is more useful than a
> rewrite: it named this exact cost, weighed it, and accepted it, and the
> weighing was wrong in a way that is worth being able to see.
>
> What it accepted was that "headsign nudged and was then overruled" would be one
> recorded fact plus one inference. The inference turned out to be not weak but
> **undecidable**, for a reason this section did not reach: `stalled` records the
> nudge cap being exhausted, and with nudges unlogged it has **no denominator**. A
> run can show the guard tripping twice while no nudge is countable anywhere. The
> argument below — "nudges 1–4 are the mechanism working, `stalled` is the
> mechanism having failed, and only the failure is news" — assumed the recorded
> failure would be legible on its own. It is not. A cap that trips out of nowhere
> tells a later reader nothing.
>
> The enumeration was also short. §1 and the documentation derived from it read an
> `unheld` line by what precedes it and offered two shapes: a transition before it
> (harmless — the work was judged), or another `unheld` (a turn that ended with no
> `next` and nothing caught it). There is at least a third, a deliberate pause
> followed by an `unheld`, and it was never considered. That is not a gap in the
> list so much as evidence the list could not be completed: a log in which the
> most frequent disposition is invisible cannot be classified by what precedes
> what.
>
> The clean statement of the mistake is one this ADR had the material to make and
> did not. §4 gave `last_stop` four dispositions — `nudged`, `unheld`, `paused`,
> `stalled` — and §1 gave the log three of them. **The record and the log were
> left disagreeing about what is worth knowing, and the one the log dropped was
> the one that happens most.** Adding `unheld` had already moved the boundary
> ADR-0004 drew; this section defended the remaining hole on a rule that the same
> ADR had just stopped following.
>
> So the log gains `held`, carrying the nudge count in the `nudges=` key
> `stalled` already uses. The cap keeps writing `stalled` and not `held` — one
> line per event, and `stalled`'s own `nudges=5` still says which hold it was.
> ADR-0004's spam-prevention rule is amended to match.
>
> The volume argument below survives and is worth keeping: it was never the
> reason. One line per exchange was correctly priced as affordable, and the
> decision turned on legibility, which is where it was wrong.

The reporter's sketch included a line per nudge. Refused, and not on grounds of volume
— that cost is one extra line per exchange, since a nudge and a flagged pass are the two
turn ends of a single exchange, which is the same order as the `advance` lines one
question already writes. ADR-0004's phrase "spam prevention" was a judgement made when
nudges were the whole mechanism and no pass line existed.

What refuses it: **nudges 1–4 are the mechanism working, and `stalled` is the mechanism
having failed.** Only the failure is news, and it is already logged, carrying the one
value of the counter anybody has wanted to read back. The intermediate values are reset
by every real `next`, so they describe a window that has closed before anyone looks.

The accepted cost, which the documentation must carry: without nudge lines, "headsign
nudged and was then overruled" is one recorded fact plus one inference. The inference is
weaker than it looks — the flag means *some* stop hook held this turn, and a repository
may install several — so what an `unheld` line establishes is that headsign stood down
after something held the turn, not that headsign was the thing that held it.

### 8. The flag makes each nudge cost a whole exchange

Recorded here because this ADR's section on the cap is where a reader forms the wrong
estimate, and nothing anywhere says otherwise.

Because a nudged turn's own ending carries the flag and passes, **five nudges cannot land
inside one turn.** They need five separate exchanges. So `stop_nudges` reaching its cap
means five exchanges with no real `headsign next`, where the reasoning given for N=5 —
"enough nudges that a functioning agent has had several real chances to respond, not so
many that a stuck session drags on" — reads as five consecutive stops.

This is an addition rather than a correction: N=5 was called "an arbitrary safety value,
not a principled number", and no claim about consecutive stops was made. But every reader
supplies the tighter reading, because the interaction is nowhere written down. The
backstop is slower to fire than that reading suggests. Not broken — slower.

### 9. The nudge message is unchanged

The sentence that would have prevented this failure prospectively exists, and it is
narrow: *if you end this turn without running `headsign next`, nothing will stop you.*
Two loose versions of it are wrong and worth correcting here, because they will be
proposed again. "Your next turn end" is the wrong unit — the nudge blocks the ending and
the model continues inside the same turn, so what passes is the end of **this** turn.
And "you will not be reminded again" is too broad: the window is one turn wide, closing
when the turn ends, because the next user message starts a turn whose ending is unflagged.

It is refused anyway. The window only bites an agent that ended its turn without doing
the thing the message in its hands already told it to do. The failure mode is
inattention, and a longer message is not the cure for inattention: every clause added
makes the first clause compete for a reader who is skimming.

Two arguments **not** used, recorded so they are not reused as if they worked. That
headsign would be promising behaviour it refuses to rely on: this ADR declines to depend
on the field for *correctness*, and describing it is not depending on it — a vanished
field would make the sentence unnecessary rather than wrong. And that the message has no
room: it has exactly such a slot, since the final-reminder phrase is already conditional.
The addition is architecturally available; the rule against dilution discourages it and
does not disqualify it.

## Consequences

- The log's vocabulary grows to twelve words. Six mark a run moving; six do not.
- `.headsign/log` answers "did the hook run at all", which is the question that started
  this. A **missing** `unheld` line does not prove it did not: the hook's writes are
  best-effort and skipped while the run's lock is held, and every document that names the
  line has to say so.
- `status` answers "how was my last turn end handled" without anyone reading
  `state.json`. The record's fields remain undocumented beyond the two the reference
  manual already names, each of which answers a question available nowhere else.
- Whether the flagged window actually costs anything is now **measurable** — but not by
  the recipe first written here, which said to count `unheld` lines with no transition
  line between them. That was wrong twice over, and both faults have the same root as
  §7's: with nudges unlogged, the line before an `unheld` is usually missing, so the
  shapes could not be enumerated. A deliberate pause followed by an `unheld` is a third
  shape the recipe had no place for, and it turned up in the field before this ADR was a
  day old.

  With `held` logged (see §7's retraction), the reading is direct rather than statistical:
  **the line before an `unheld` says what happened.** A `held` means headsign nudged and
  was then overruled. A transition means the work was judged and the pass cost nothing. A
  `paused` means a deliberate pause was consumed. That measurement is still the input to
  a question this ADR does not answer — whether headsign should stop honouring
  `stop_hook_active` and rely solely on its own cap, which would close the window at the
  price of blocking a turn the platform asked not to be blocked. What field data exists so
  far points away from urgency: the first `unheld` lines anyone reported were all
  deliberate pauses rather than missed judgments. Deciding on one run's worth of that
  would be the same guessing this bullet warned about, from the other side.
- The reporter is on a released build, which still truncates the log at `start`
  (ADR-0024 is newer than the release). None of this reaches them until a release says so.
