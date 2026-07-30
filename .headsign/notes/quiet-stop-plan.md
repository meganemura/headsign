# Making a quiet stop observable

A plan produced by grilling one piece of feedback from a project that uses headsign. The
report is kept verbatim at `.headsign/notes/quiet-stop-feedback.md`; this file is what to
build, and can be read without it.

## The problem, in one paragraph

A session driving a run several phases per turn noticed that the stop-boundary hook's nudge
appeared only on alternate turn endings. The cause is real and unavoidable: Claude Code
sets a flag on the hook's input once a stop hook has held a turn, and headsign honours it by
passing that stop through. What made this a bug report is that the pass leaves **no trace
anywhere** — not in `.headsign/log`, not in `.headsign/state.json`, not in `headsign
status`. So the reporter could not distinguish *the hook ran and stood down* from *the hook
is not installed*, and went to inspect their plugin configuration. On the way they read
`"stop_nudges": 0` out of the run record and correctly concluded the nudge cap was not the
cause — leaving them with a field that answered a question they had not asked and nothing
that answered the one they had.

## Two names to use throughout

Fixing the vocabulary first, because the wrong words are already in circulation — including
in the notes that produced this plan.

**Do not call Claude Code's flag "the loop guard".** That is headsign's own name for
`stop_nudges`: ADR-0006's section heading, the branch label in `stophook.ts`, the comment in
`engine.ts`. The two are sibling mechanisms at the same boundary producing the same
observable outcome — a stop that passes quietly — which is precisely the pair a reader has
to tell apart. Call the platform's mechanism **the already-continuing flag**, from the
upstream gloss ADR-0006 records ("Claude is already continuing as a result of a stop hook"),
and name the field itself only as `stop_hook_active`.

**The new log event word is `unheld`.** Not `pass`: that is headsign's own token for a gate
succeeding — `GateVerdict`'s passing arm is literally named `pass` and `engine.ts` branches
on `gateResult.kind === "pass"` — so it would be the same string in the same file for the
opposite kind of event. `unheld` is the negation of the verb headsign's own documentation
already uses for what the hook does to a turn ("holds an agent when it matches the recorded
driver", "Being held there says the run is running"), and it carries no suggestion that
headsign chose to let go. It did not; it was overruled.

## What gets built

### One new log event, for exactly one situation

Every place either hook lets a stop through was enumerated, and all but two already leave a
trace: the pause note has `paused`, the exhausted cap has `stalled`, the bystander passes are
covered by the driver's `claimed` line and by `status`'s `driver:` line, and observer /
unparseable-input / no-run / vanished-record are all "headsign has no run in hand". The
already-continuing flag is the one situation with nothing behind it, and it gets the one new
line:

```
2026-07-30T23:06:51+09:00 unheld decide a=0 i=21 by=stop_hook_active
```

The detail is **bare, not quoted**. `render.ts`'s rule is quotes for free text and bare for
identifiers — it says so where the graph-change line writes phase keys, "they are
identifiers … not free text like a reason" — and `stop_hook_active` is an identifier.

Naming the upstream field in the detail is deliberate: the diagnostic chain runs from the log
line, through headsign's source, to the hook payload a person can print, to whatever upstream
documentation exists, and that token is the single link common to all four. The event-word
slot stays inside headsign's own vocabulary.

The second traceless situation is **not** being fixed, and the reason is worth keeping: a
stop that passes because the run's lock was held usually has the concurrent lap's own line as
its trace, but a lap answering `PENDING` writes neither state nor log, so that combination
leaves nothing. Recording it would mean writing with counters read before the lock, about a
run another process is mid-way through changing — a line stamped now and counted then. The
gap is accepted and documented instead.

### A `last_stop` field in the run record, written with the line

The record gains one field:

```json
"last_stop": { "disposition": "nudged" | "unheld" | "paused" | "stalled", "at": "<local ISO>" }
```

Written **in the same `withRunLock` call as the log append**, which is what makes a field and
a line safe to have together: `withRunLock` writes the record and appends the line in one
locked operation, so both land or neither does. This is the shape `paused` already uses.

Written on every stop the hook processes **and can attribute**: a nudge (which already writes
the record, so this is free), an `unheld` pass, a pause, and the pass that happens because the
cap is spent. Not written where headsign cannot attribute the stop or cannot write at all —
observer, unparseable input, no run, a bystander's stop, or a held lock.

Writing it on *every* attributable disposition rather than only on passes is the whole point,
and it is the lesson of the field that misled the reporter. A field written only on passes
would still read "not held at 23:06:51" long after a later nudge, and a reader would take a
stale value for a current one. The residual staleness — after a bystander's turn end the field
still describes an earlier stop — is the same limit `status`'s `driver:` line carries, and gets
the same treatment: print it, document the limit.

This field is a second representation of the same event, and that is the house pattern rather
than a smell: `claimed` sits beside `driver_agent`, `paused` beside the `stop_nudges` reset,
`stalled` beside `stop_nudges: 5`, `graph-changed` beside `graph_change_reported`. The log
holds the event, the record holds the current value, and ADR-0004 calls `state.json` "the
external memory".

Two new record writes appear on paths that write nothing today — the `unheld` pass and the
cap-spent pass — roughly one per exchange, the same order as `next`'s own per-lap write.

### The already-continuing check keeps its guarantees and gains a body

For the line to name a phase and belong to the right party, the check has to see the record.
Today it cannot: in `Stop` it runs before the record is read, and in `SubagentStop` before the
run has even been located.

What must survive any change: a flagged turn end **is never blocked**, and **never spends a
one-shot resource**. One action violates both at once and therefore governs the design —
consuming `.headsign/tmp/claim` seats a driver *and* blocks.

- **In `Stop`, move the check down** to immediately above the nudge flow. Everything it now
  passes over is read-only (read the record, test the status, test for a recorded driver), and
  the pause note is opened only inside the nudge flow. It then knows the phase, and knows the
  run is unclaimed, because a claimed run returned one step earlier.
- **In `SubagentStop`, do not move it past the adoption gate.** That gate consumes the marker
  and blocks, and its position is itself decided — ADR-0010 requires it to precede the owner
  comparison. Give the check its own branch instead: resolve `agent_id`, compare it against
  `driver_agent`, write if it matches, and return. The branch never reaches the adoption gate.

The asymmetry is in placement only. ADR-0010's rule that the two hooks behave alike is about
observable behaviour, and under this plan both record an `unheld` pass under the same
condition, write the same line, and block nothing. ADR-0010 itself notes the two share
"everything below the adoption gate", which concedes that above it they do not.

Prefer the branch's safety to come from *returning before the gate exists in its path* rather
than from sitting above it: a later reordering can undo a position and cannot undo a return.

The new cost is smaller than it looks. A bystander subagent's unflagged stop already pays the
walk-up, record read, agent-id resolution and driver comparison; this makes a flagged stop
cost what an unflagged one already costs. The genuinely new cost is one walk-up for a flagged
subagent stop in a repository with no run at all, where the hook pays nothing today.

### `headsign status` grows two lines

**The last stop.** Sourced from the record, so no parser and no reading of the log:

```
RUNNING decide (attempt 0/5)
workflow: design-grilling
driver: not delegated yet — no agent has claimed this run
last stop: not held — Claude Code had already resumed the turn (stop_hook_active) — at 23:06:51
```

with the other dispositions reading `held, and pointed back to headsign next`, `paused by a
note`, and `not held — the nudge cap is spent`. A run whose record has no `last_stop` prints
no such line, so output is byte-identical to today until a stop has been processed.

The objection that nearly killed this line — that it reports an unattributable fact where a
reader will assume it is about them — does not survive the check's new position. From
`SubagentStop` the pass belongs to the driver by positive match; from `Stop` it belongs to a
session stopping on a run nobody has claimed, which is the party the hook would otherwise have
nudged. The residual case (two sessions on one unclaimed run) is already documented for the
nudge itself, and `driver:` is the standing precedent for printing a party-related fact with a
written limit.

**The observer switch**, when it is set in the calling environment:

```
observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held
```

This is the only quiet-ending cause a caller can answer *about itself*, with no identifier to
resolve, which makes it the cheapest honest diagnostic available. Two qualifications belong
with it: what is read is the environment of the process `status` runs in, normally the
session's but not necessarily; and nothing in headsign outside the hook path reads the
environment today, so this threads a new argument into a function that takes only a directory
— following `stophook.ts`'s "both arrive as arguments" shape rather than inventing one.

The hook's observer path stays a **complete no-op**. Writing there would undo the
short-circuit that makes the opt-out an opt-out (the check runs before the input is parsed and
before the walk-up, so logging would require the whole body of the hook), and it would record a
non-participant in the record of a run it opted out of.

### Documentation, split by how long each fact stays true

Where-to-look survives changes to any counter; a field's mechanics change when the field
changes. So:

**The skill's quiet-ending list** keeps its parenthesis form — it is read by an agent about to
drive a run — and gains the missing cause plus the expectation the reporter asked for: a nudge
arrives roughly **once per exchange**, not once per turn end, because the ending of a nudged
turn carries the already-continuing flag. The window is one turn wide and closes when the turn
ends.

**The reference manual** gains a where-to-look table:

| a turn ended quietly because | how you tell |
| --- | --- |
| Claude Code had already resumed the turn | an `unheld` line in `.headsign/log`; the last-stop line in `headsign status` |
| a pause note was consumed | a `paused` line in the log |
| the nudge cap is spent | a `stalled` line in the log — and no such line means the cap is innocent |
| nobody has claimed the run, or the stopper is not the driver | `driver:` in `status`, which narrows rather than settles |
| `HEADSIGN_OBSERVER` is set | the observer line in `status` |

The fourth row must carry its caveat or the table teaches the very over-reading that produced
this report: `driver:` reports whether *some* delegated agent holds the run, never whether the
reader is that agent, and checking the log instead does not rescue it — the log spans runs, so
a `claimed` line may belong to one that ended days ago. Wherever the `unheld` line is named,
say also that the hook's writes are best-effort and skipped while the run's lock is held, so a
**missing** line does not prove the hook did not run.

**ADR-0006** gains the counter's mechanics — that a real `headsign next` resets `stop_nudges`
unconditionally inside `step()`, that the already-continuing flag never touches it, and that
the flag makes each nudge cost a whole exchange, so five nudges mean five exchanges without
progress rather than five consecutive stops. That last is an addition, not a correction: the
ADR never claimed consecutive stops, calling N=5 "an arbitrary safety value, not a principled
number" — but nothing tells a reader about the interaction, so every reader arrives at the
tighter estimate.

One rule for every sentence that names `stop_hook_active`: describe what headsign **does with**
the field, never assert what upstream's documentation currently says. ADR-0006's dated line
about the field no longer being documented is the example of why a published claim about
somebody else's documentation rots silently.

## The order to build it in

1. **The decision record**, first, because five existing ADRs are touched and the vocabulary
   above has to be fixed before code uses it. A new ADR carries the design; it amends ADR-0004
   (the log gains a twelfth event word and the record a field), ADR-0006 (the flagged branch
   gains a body; the counter's mechanics and the exchange-cost interaction), ADR-0002 (the
   `status` contract grows two conditional lines), and ADR-0008 (the observer switch becomes
   reportable, while the hook path stays a no-op).
2. **`state.ts`** — the `last_stop` shape, with the tolerant read for a record written before
   it existed and the written criterion for removing that tolerance, matching what
   `driver_agent` and the graph-pin fields already carry.
3. **`render.ts`** — `LogEvent` gains `UNHELD`; `eventName` and `logDetail` gain their arms;
   `statusRunning` gains the two conditional lines.
4. **`stophook.ts`** — move the check in `evaluate`; add the branch in `evaluateSubagent`;
   write the field and the line together at each attributable disposition.
5. **`engine.ts` and `cli.ts`** — `status` reads `last_stop` tolerantly and takes the
   environment as an argument.
6. **Tests**, including the three that would catch a regression of the hard parts: that a
   flagged subagent stop with an armed claim marker still passes and leaves the marker armed;
   that a flagged stop on a claimed run writes nothing; and that the field and the line are
   both absent when the lock is held.
7. **The user-facing documents** — the skill, the reference manual and its Japanese
   counterpart, and the README if the quiet-ending list reaches it.
8. **Back the documentation's claims with tests**, per this project's rule that behavioural
   claims in prose get verified before release. The table above makes five claims about what
   proves what; each is a test.

## Deliberately not being done

- **Nudges 1–4 get no log lines.** They are the mechanism working; `stalled` is the mechanism
  having failed, and only the failure is news. The intermediate counts are reset by every real
  `next`, so they describe a window that has closed before anyone looks, and the one value
  anybody has wanted to read back is already in `stalled`'s `nudges=5`.
- **The nudge message is unchanged.** The precise sentence that would prevent this failure
  exists — *if you end this turn without running `headsign next`, nothing will stop you* — and
  the window only bites an agent that ignored the instruction it was already holding. The
  failure mode is inattention, and a longer message is not the cure for inattention. Reconsider
  this first if the documentation turns out not to reach drivers, and use that wording.
- **The lock-held pass stays traceless** when the concurrent lap answers `PENDING`. Documented,
  not fixed.
- **A subagent stopping on an unclaimed run gets no line**, even though it may be the agent
  driving the run that forgot to `headsign claim` — a quiet failure the manual already
  documents. At that branch headsign cannot tell that agent from an unrelated reviewer, so the
  line would fire for every subagent in the repository. Undecidable, not unimportant.
- **`headsign start` does not warn when `HEADSIGN_OBSERVER` is set.** Better targeted in
  principle, since it fires when the contradiction is created — but the configuration is
  *correct*: a lead that sets the switch, runs `start`, and delegates driving to an agent that
  claims the run is the arrangement ADR-0010 exists to support. A warning on the recommended
  setup teaches people to ignore warnings.
- **`state.json`'s fields are not documented any further.** Two are already named in the
  manual, and each answers a question available nowhere else. A resetting counter whose every
  event is a log line is not one of them.
- **No log rotation.** A `status` that reads the record rather than the log leaves ADR-0024's
  "no rotation, no size cap" untouched.

## One thing to know before promising this to the reporter

The plugin bundle that drives a run today is the released build, and the released build still
truncates `.headsign/log` at `headsign start` — the working tree stopped doing that only
recently. So the reporter is very likely on a build that predates even the log's survival
across restarts, and none of this reaches them until a release. Say so when replying, rather
than describing behaviour they cannot yet see.

## Where the answers came from

Nine of the ten decisions were settled by explaining and then arguing with the explanation;
one went to a person. That one was whether `status` should report the last stop at all — and
the person's answer changed a *different* decision, which is recorded below.

The record of what the arguing moved is in `corrections.md`, kept beside this file. Read it
before treating any of the above as obvious: the landing changed once, and in almost every
other case the reasons changed even where the answer did not. Its headline findings:

- **The refusal to add a record field was wrong, and a person caught it.** The argument had
  been that a field and a log line could diverge, and that a second copy of one fact is a
  smell. Both fail: `withRunLock` writes the record and appends the line in one operation, and
  four existing pairs in this very file do exactly what was being called a smell. The lap's
  own challenge phase had asked whether the *costs* were grouped correctly and never asked how
  the record's existing fields relate to the log's existing lines. The lesson is narrow and
  reusable: when refusing something because it duplicates, count the existing duplications
  first.
- **"Loop guard" was in use throughout the reasoning for the wrong mechanism**, until the
  naming question forced a check. Every note written before that point needs the substitution
  made above.
- **Two costs charged against this design were largely imaginary**: that logging pass-throughs
  would flood the log (it is one extra line per exchange, the same order as the transition
  lines a single question already writes), and that a bystander subagent would newly pay for a
  walk-up and record read (it already pays both on its unflagged stops).
- **A "trace" relied on twice turned out to be conditional.** A stop passing while the lock is
  held was said to be covered by the concurrent lap's own log line — until a lap answering
  `PENDING`, which writes nothing, turned that into the second traceless case.
- **The claim that nothing in the documentation invites reading the run record was false.**
  The manual names one field in prose and another in a where-to-look table. The reporter's
  detour was taught, not invented, which changed the shape of the documentation answer from a
  prohibition into a distinction.
