# Decisions — the module-first fitness sweep

## Should the sweep's unit of explanation become the module rather than the function?

**Decision: yes, the module becomes the unit — conditional on the judge's
question changing with it.**

Reason: the module boundaries in this repository are written-down decisions,
not incidental ones. `docs/architecture.md` gives every module a one-line
responsibility and an explicit "Must NOT know about" list, and each module's
header comment repeats its own. A module-level explanation therefore tests
something the project already claims about itself. The library argument —
"unclear interfaces cost every caller" — does not carry here: in seven modules
under a thousand lines, read start to finish by the agent maintaining them,
every caller and whoever opens the file are usually the same reader.

The pilot supports it from the other side. The two hardest functions in
`gate.ts`, `isReady` and `resolveRoute`, were hard because each encodes a
policy — which way to fail when a command cannot run at all — and both
policies are contract, not implementation. A boundary explanation is forced to
confront them.

Cost, with the two kinds separated because they do not move together:

| Sweep | laps, all first-time |
|---|---|
| Every function in `src/` (today) | 271 |
| Every module (proposed) | 25 |
| Every module, then inside all of them | 292 |

Laps fall about tenfold; **writing effort falls perhaps two to four times, not
ten** — a boundary explanation of `cli.ts` is a long document, not one
twenty-third of its functions' total. What changes decisively is that the
sweep stops being blocked by its own arithmetic. The last row is the losing
side of the bet: 292 against 271 is what it costs to ask the boundary question
first and learn nothing from it.

**The condition, and it is not optional.** The judge detects gaps it can see
the edge of, and never a subject that was not raised. In the pilot it named
exactly what it could not predict — a truncation line's wording — because the
explanation had gestured at it without giving it; nothing would have made it
ask about output handling had no sentence mentioned output. At function level
that blind spot barely matters, because the unit is small enough that an
omission shows as a hole. At module level, omission is the default failure.

The pilot's one rejection is the case in point: `buildTail` is private, so a
module sweep would never have looked at it — yet its behaviour reaches the
person, as `(no output)` printed through `runGate` in a real failing run.

So the judge's question changes from "could a reader predict what this does"
to something a reader can fail: **could a caller who read only this be
surprised by this module's observable behaviour?** Surprise is detectable in a
way completeness is not.

## Should a module's explanation be written from its exported interface only, without describing what happens inside?

**Decision: no to "exports only". The rule is: describe everything a caller
can observe — including the arrangement they can observe — and nothing they
cannot.**

Reason: `export` marks who may call a name; a contract is about what a caller
can notice. Two modules in this repository refute the equivalence outright.
`gate.ts` keeps `buildTail` private, yet that function decides the literal
`(no output)` a person reads when a check fails, along with the 4,000-character
cut and the surprise that a great deal of output ending in blank lines is
reported as none. And `cli.ts` exports **zero** things — twenty-three
functions, no top-level exports — so "exports only" would produce an *empty*
explanation of the largest module in the project. (Counts: render 15, state
11, engine/gate/workflow 6 each, stophook 3, cli 0.) Its real contract is the
one ADR-0002 writes down: the first-line tokens, the exit codes, what is
idempotent, what writes state.

**Arrangement is in where it is observable.** `runGate` runs checks in order
and stops at the first failure, so the later checks' side effects never
happen; `resolveRoute` takes the first entry whose command succeeds. A caller
who does not know those cannot predict the result. Out is what nobody can
detect: which private functions exist, what calls what, internal step order,
data that never leaves.

**There is no cheap mechanical check for this rule.** "Must not name a private
function" fails both ways — a writer can tour the internals without naming
anything, and naming a private thing is sometimes right. So the judge's
question carries the whole weight, which is why it and this writing rule are
deliberately the same rule from two sides: the writer covers what is
observable, the judge asks whether anything observable could still surprise.
Two different bars would mean approving work written to a standard nobody
checks.

Accepted cost: a boundary explanation becomes real analysis rather than a
transcription of signatures — for `cli.ts`, reasoning about the whole file to
write a description that never mentions its parts. That is the intended cost;
a transcription would find nothing.

## When a module's explanation is rejected, should the sweep descend into that module's functions, or record the module itself as the finding?

**Decision: both, and the trigger is exhaustion, not rejection. Descend when
the three attempts run out, and record the module's boundary failure alongside
whatever the descent finds.**

Reason: the two are not alternatives. A rejection has two possible causes that
cannot be told apart when it happens — the writing was bad, or the module
cannot be explained — and the judge cannot distinguish them either, having
never seen the code. The three-attempt loop tests the first: attempts 2 and 3
are written after reading the judge's note, which pushes the writer off its
own reading. The pilot's single rejection cleared on attempt 2 exactly that
way, with nothing wrong with the code.

But exhausting the attempts proves less than it looks. Three attempts is one
writer with one set of blind spots trying three times, and the correcting note
is the judge's reading of the *explanation*, never of the code — so the loop
can fix unclear writing and cannot fix a wrong mental model. The honest claim
is: one writer, corrected twice by a reader, could not state this module's
boundary. That is a reason to look inside, not a verdict. **The descent is
what decides between the two causes**, rather than the consequence of having
decided.

Descending produces a finding either way, and the second kind is new:

- **Some function inside also fails** → the address narrows to that function.
  What the sweep produces today, reached for a tenth of the price on the
  modules that never needed it.
- **Every function inside is clean** → the parts are fine and the whole is
  not. That is a statement about the module's *responsibility*: a file doing
  two things, or one whose declared responsibility in `docs/architecture.md`
  no longer matches what it holds. **The per-function sweep cannot produce
  this finding at all** — it has no notion of a whole to compare the parts
  against.

Costs accepted:

- Seven laps before a descent starts on a module that was never going to
  explain itself (three attempts at two laps, plus one to file the
  exhaustion).
- **The report now has two kinds of entry.** A reader must hold the difference
  between "this module's boundary failed" and "this function failed", and a
  report that blurs them is worse than one that only ever had functions in it.
- **The retry cap and the clear-and-rewrite rule were sized for function-sized
  writing.** `explain` clears its output on entry, so every attempt is a
  rewrite from scratch — cheap for a function, a different bill for a boundary
  document covering `cli.ts`. And only the latest judge note survives on disk,
  so attempt 3 rewrites a long document knowing only what went wrong with
  attempt 2. Not a reason to decide differently; a reason to revisit both.

## Should the decision to descend be made by the gate reading the verdict, rather than by the judge or the working agent saying "go deeper"?

**Decision: a route decides — reading a count of the judge's verdicts, not of
the writer's self-reported tries.**

Reason, and the easy one is wrong. "Transitions must be decided by exit codes,
never by the LLM" does not settle it: the judge's word already drives a route
(`grep -qx APPROVED`), and ADR-0007 exists to name that boundary rather than
hide it. A third verdict word would cross nothing still uncrossed.

The real reason is that **descending is a decision about a sequence**, and the
three candidates stand differently to it:

- **The judge is kept blind to sequences on purpose.** It is given one file
  and told to read that and nothing else, and every attempt is written from
  scratch, so nothing in its input carries a trace of an earlier one. That
  blindness is the whole value — it is the position of a reader meeting the
  module for the first time. Telling it the attempt number would make it judge
  something other than the explanation; letting it guess on attempt 1 would
  remove the loop that separates a writing failure from a design failure.
- **The working agent can see the sequence and is the interested party.**
- **A route can see the sequence and has no stake in it** — but only if what
  it reads was not written by someone who does.

**That last clause inverts the easy answer.** `tries` is appended by `explain`,
the working agent's own phase, so the counter that triggers the descent is
already written by the party with an interest in reaching it. Today that is
small (over-counting gives up on one function early). Under this design it is
large: an agent facing a third from-scratch rewrite of `cli.ts`'s boundary has
a plain motive to descend, and reaching it costs one extra `echo`, checked by
a `test -s` that cannot tell a fresh line from a stale file.

**So the fix is to count the judge's verdicts, appended rather than
overwritten.** A verdict exists only because a judge wrote one, and the judge
has no stake in whether the writing continues. This also closes the hole the
earlier grilling recorded and left open — only the latest note survives today,
so attempt 3 rewrites a long document knowing only what went wrong with
attempt 2. An appended verdict log keeps every note. One change, two holes.

**This makes the counter defect a precondition, not a known bug:** the design
does not work until the count comes from the judge's side of the wall.

## Should a rejection be separated into "the writing was bad" and "the design is bad" before the sweep descends?

**Decision: no — at rejection time that separation does not exist in anyone,
and the descent produces it. But the question exposed a leak on the approval
path, and the judge's question gains a second half because of it.**

Reason for the "no": the judge has read one explanation and no code, so a
fumbled explanation and an unexplainable module look identical from where it
stands. The working agent has read the code, but it is the one being judged
and has the strongest interest in the answer — its view is already collected
without giving it a route, since `explain` tells the writer to say what makes
a clause hard and that report lands in the explanation the judge reads. And no
shell check has anything to test: the difference is not a property of any
file. The descent settles it factually instead — some function also fails, or
every function is clean and the whole is the problem.

**The leak.** Apply `explain`'s honesty rule to a module that does two
unrelated things and the honest explanation says so — and is *perfectly
predictable*. A caller can say what it does, what comes back, what happens at
the edges. Nothing surprises them, so the judge approves, and the file's lack
of a single responsibility is recorded nowhere. Surprise is about
predictability; an unfocused module is not unpredictable, only scattered.
Those come apart completely, and the module-level unit was chosen precisely to
catch the scattered case.

**The fix, and the first version of it was wrong.** "Open with one sentence
saying what the module is for" is gameable by vagueness — "this module handles
workflow things" passes, and vagueness is the failure the standard already
warns about. What is not gameable is the pairing `docs/architecture.md`
already uses: a responsibility **and** an explicit "must NOT know about" list.
A vague purpose cannot generate a meaningful exclusion list. So the
explanation must open with two sentences: what this module is for, and what it
deliberately does not know about.

**Worked example, and it is the module the pilot swept.** `gate.ts`'s own
table entry is two clauses joined by a semicolon — run the phase's checks,
*and* resolve which route matched. Its header answers the charge ("Both are
'run shell, read exit code'"), and a writer could produce a true unifying
sentence. So the test yields an argument, not a verdict — and that argument is
one the per-function sweep never raised at all.

**Cost, and it has stopped being a footnote.** The report now has three kinds
of entry: a function that cannot be explained, a module whose boundary cannot
be stated, and a module that is explainable but unfocused. `report`'s job
today is to count and name. Three kinds of finding is a reporting problem, and
it is now the weakest part of this design.

## On descending into a module, should the queue take only its exported functions, or every function in it?

**Decision: every function with a name of its own — declared functions and
named constants holding functions — and not anonymous inline callbacks.**

Reason: `export` was already ruled out as a boundary two decisions ago, and it
fails twice as hard here. `buildTail` is private and was the pilot's only
rejection, so an exports-only descent would skip the one function in `gate.ts`
that has ever failed a judge. `cli.ts` exports nothing, so an exports-only
descent into it queues nothing — the sweep would reach the module least able
to explain itself, look inside, find an empty list, and report that all was
well.

**The floor, which had been ambiguous in every discussion so far.** Counted
directly rather than by subtracting two greps that were not measuring the same
thing: `src/` has **76** named functions and **11** anonymous arrows written
inline as arguments. The eleven stay out, for a reason that is not about size
or nesting: **the ledgers are keyed by `module.ts:name`, so a thing with no
name cannot be recorded, only encountered.** It also has no independent
contract — it lives inside one expression of one function, whose explanation
has to account for it anyway — and including the eleven costs 33 laps for
entries no report can list. Two edges are left open deliberately: a constant
holding an object of functions, and a function returned and then assigned.
Neither exists in `src/` today.

**Rejected: descending only into the functions the judge's note implicates.**
Cheapest of all, and the most tempting. It fails twice. Mapping a behaviour to
a set of functions is a judgment about the code, and the only participant able
to make it is the working agent whose boundary explanation just failed three
times — asking it which parts should be examined is asking the examinee to set
the syllabus. And it destroys the descent's second outcome: "every function
here is clean, so the problem is the whole" is a statement about the module
only if every function was asked about.

Accepted cost: a named one-line helper is still queued and still costs three
laps. Deliberate — a rule that skipped functions for being short would need
somebody to judge shortness, and the sweep would start deciding what it was
allowed to find.

## Should the per-function sweep be replaced by the module-first one, or kept as a second workflow alongside it?

**Decision: one workflow. Replace the second file, keep the second mode.**

Reason: the per-function sweep is not a separate thing that resembles the
module sweep — it *is* the module sweep's descent, same phases, same judge,
same ledgers. Only what fills the queue differs. A second file would copy a
graph that has no way to be shared: ADR-0003 refuses `uses:` and reusable
fragments on purpose, so two workflows means two permanent copies, and
headsign's own notes name that failure (state a rule once and reference it).
This list alone produced six changes to that graph — the judge's question
becomes about surprise, the explanation opens with purpose and exclusion, a
`descend` phase and its route, the attempt count moves from the writer's tries
to the judge's verdicts, `inventory` queues one module, the descent floor is
named functions — and the previous grilling left four more unapplied. Copies
would disagree within a correction or two, while both still reported passes.

**The distinction is already in the data.** A module is `gate.ts`; a function
is `gate.ts:runGate`. The queue holds basenames, never paths, so a colon can
only mean "a function name follows" — a shell test, not a judgment. Verified
against both shapes. So the exhaustion route out of `judge` splits:

```yaml
- when: 'test "$(...count...)" -ge 3 && ! grep -q ":" .headsign/tmp/current'
  to: descend
- when: 'test "$(...count...)" -ge 3'
  to: record
- to: explain
```

`descend` is gatable on both halves of its job: the module's functions are in
the queue (`grep -qF "$(head -n 1 .headsign/tmp/current):" .headsign/tmp/queue`)
and the module's own boundary failure is on the record. The second half is
required by decision three — without it a module that descends vanishes from
the ledgers and the report shows functions only.

A per-function run is then the same workflow started with a queue of
functions, exactly as the pilot was told to sweep one module rather than all
of `src/`.

Costs, handled rather than smoothed over:

- **`inventory` now has two jobs**, days after decision five made "does this
  have one job?" the question asked of every module. Not fatal: that question
  is asked of *modules*, which have callers and whose boundary is a promise to
  someone else. A phase has one caller — the run — and its instruction is
  stage direction. What would be fatal is two jobs producing two graphs, and
  they do not.
- **How a run was started is not recorded.** Rather than hand that to `report`
  (already carrying three kinds of finding), `inventory` writes what it queued
  to `.headsign/tmp/scope` and `report` is gated on its summary naming it. The
  scope is set by the phase that knows it, when it is known. This also
  discharges the previous grilling's follow-on that a summary must name the
  swept set.
