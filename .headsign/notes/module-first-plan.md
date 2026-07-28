# The module-first fitness sweep

Produced by `.headsign/grilling.yaml` (`design-grilling`), 2026-07-28, seven
questions. All seven answers came out of the explaining; none needed a person.
Grounded throughout in the `gate.ts` pilot run that preceded it — its
verdicts, its one rejection, and its measured lap count.

## The design in one paragraph

The sweep walks **modules**, not functions. For each one the writer produces a
boundary explanation — everything a caller can observe, nothing they cannot —
and a judge that has read only that explanation answers whether a caller could
be **surprised**, and whether the document describes one job or several. Three
attempts. If they run out, the sweep **descends**: it queues that module's
named functions and explains them one at a time, exactly as the sweep does
today, and records the module's boundary failure alongside whatever the
descent finds. A module that explains itself is never descended into — that
pruning is what makes the design cheap.

## The seven answers

**1. The module becomes the unit** — conditional on the judge's question
changing with it. Laps for all of `src/` fall from 271 to 25 when everything
explains itself, and climb toward 292 only where it does not; writing effort
falls by perhaps two to four times, not ten. The reason is not cost: the
module boundaries here are *declared decisions*, written in
`docs/architecture.md` with a responsibility and a "must NOT know about" list
each, so a boundary sweep tests something the project already claims. The
condition is not optional — the judge detects gaps it can see the edge of and
never a subject that was not raised, and at module level omission is the
default failure. So its question becomes *could a caller who read only this be
surprised by this module's observable behaviour?*

**2. The explanation covers what a caller can observe, not what is exported.**
`export` says who may call a name; a contract is what a caller can notice.
`gate.ts` keeps `buildTail` private, yet that function decides the `(no
output)` a person reads. `cli.ts` exports **zero** things, so "exports only"
would produce an empty explanation of the largest module in the project.
Arrangement is in where it is observable (checks run in order and stop at the
first failure), out where nobody can detect it. There is no cheap mechanical
check for this, so the judge's question carries its whole weight — which is
why the writing rule and the judge's question are deliberately one rule seen
from two sides.

**3. On exhaustion, descend — and record both.** A rejection has two possible
causes that nobody can separate when it happens; the descent produces the
separation factually. Either some function also fails, and the address
narrows, or every function is clean and **the parts are fine while the whole
is not** — a finding about the module's responsibility that the per-function
sweep cannot produce at all, having no notion of a whole to compare parts
against. Exhausting three attempts proves less than it looks (one writer,
corrected twice by a reader who has never seen the code), which is why the
descent decides rather than confirms.

**4. A route decides the descent, reading a count of the judge's verdicts.**
Not because LLMs must not route — the verdict word already drives one, and
ADR-0007 names that. Because descending is a decision about a *sequence*: the
judge is kept blind to sequences on purpose, and the working agent can see the
sequence but is the interested party. **And the working agent already writes
the counter**, which under this design gives it a motive: one extra `echo`
escapes a third rewrite of `cli.ts`'s boundary. So count the judge's verdicts,
appended rather than overwritten — authored by the disinterested party, and it
also preserves every judge note instead of only the latest.

**5. No cause-separation at rejection time; the judge's question gains a
second half.** Nobody can separate "bad writing" from "bad design" when the
rejection lands. But writing that out found a leak on the *approval* path: an
honest explanation of a module that does two unrelated things is perfectly
predictable, so the judge approves it and the scattering is recorded nowhere.
The fix is not "open with one sentence saying what this is for" — that is
gameable by vagueness. It is the pairing `docs/architecture.md` already uses:
**a purpose and an explicit "does not know about" list**, because a vague
purpose cannot generate a meaningful exclusion list.

**6. The descent queues every named function** — declared functions and named
constants holding functions — and not the 11 anonymous inline arrows. The
floor is not about size: the ledgers are keyed by `module.ts:name`, so a thing
with no name cannot be recorded, only encountered. Counted directly, `src/`
has 76 named functions and 11 inline arrows. Rejected: descending only into
the functions the judge's note implicates — that mapping is a judgment only
the examinee can make, and it destroys the "parts clean, whole not" finding.

**7. One workflow, not two.** The per-function sweep *is* the module sweep's
descent. A second file would copy a graph that cannot be shared (ADR-0003
refuses reuse mechanisms), and this list alone changed that graph six times.
The distinction is already in the data — `gate.ts` versus `gate.ts:runGate`,
told apart by a colon — so the exhaustion route splits on a shell test, and a
per-function run is the same workflow started with a queue of functions.

## The order of work

1. **Fix the attempt counter first — the change that moves it to the judge's side.** Count the judge's verdicts,
   appended. This is a precondition, not a cleanup: every other change assumes
   the descent fires when it should, and today `test -s` cannot tell a fresh
   attempt from a stale file. It also closes the note-history hole the previous
   grilling recorded.
2. **Rewrite the judge's question, and the writing rule it mirrors** — surprise, plus one
   job or several — and the writing rule it mirrors. These are the same rule
   and must land together.
3. **Add `descend` and split the exhaustion route.** Gate
   it on both halves: the module's functions are queued, and its boundary
   failure is filed.
4. **`inventory` writes `.headsign/tmp/scope`; `report` is gated on the
   summary naming it.** This also discharges the previous
   grilling's "name the swept set" follow-on.
5. **Make `report` legible (the accumulated cost).** Three kinds of finding —
   a function that cannot be explained, a module whose boundary cannot be
   stated, a module that is explainable but unfocused — and two kinds of run.
   `report` currently counts and names. This is now the weakest part of the
   design.
6. **Then run it**, module-first over `src/`, and see which of the seven
   modules descends.

Still outstanding from the previous grilling, unchanged by this one: the
`report` check that the queue was really emptied, the durable gated output for
`report`, and the `improve` check that the notes actually changed.

## Deliberately not being done

- A per-function workflow as a second file.
- Descending on the first rejection, or into only the functions a judge's note
  implicates.
- Letting the judge or the working agent decide the descent.
- Sweeping anonymous inline callbacks.
- Asking anyone to label a rejection "writing" or "design" when it happens.
- Using `export` as the boundary of what an explanation must cover.

## Whether this loop earned its keep

Seven of seven answers came out of the explaining. Every one of them changed
in the `challenge` phase, and three changed materially:

- The cost table was measured in laps, which is the wrong unit for the
  complaint that started this ("it would take quite a while") — most of that
  time is writing, and writing falls by two to four times, not ten.
- The argument about who may trigger the descent inverted. The route is the
  disinterested participant, *except* that the counter it reads is written by
  the interested one — and this design gives that participant a motive it did
  not have before.
- Asking whether a rejection should be labelled "writing" or "design" was
  answered "no" — and then found a hole on the opposite path, where an honest
  explanation of an incoherent module passes. Nothing about the question as
  asked would have surfaced that.

The `challenge` change made after the last run — attack the groupings, not
just the load-bearing words — earned itself on that same question, where the
fault was that "rejection" had been treated as one kind of event with one kind
of cause.

One thing this loop did not do: no question went to a person. That is not
obviously good. The list was framed by the same agent that answered it, and a
question nobody thought to ask cannot be dissolved by explaining it well.
