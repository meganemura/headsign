# Fitness sweep — the 11 value import seams between the modules of src/

## What was swept

**the 11 value import seams between the modules of src/** — the relationships,
not the modules and not their functions.

An import edge carries values in 11 of the 14 cases; the other three share
only types, so nothing is called and nothing is assumed. This certifies those
11 relationships and nothing else. No module's own boundary and no function
was examined in this run — those were swept earlier, separately.

## The verdict

**Failed**, and the failure is one item: `engine.ts>state.ts` ran out of its
three attempts. Ten of eleven approved. 65 laps.

## The findings

### Items nobody could explain

**`engine.ts>state.ts`** — and the honest reading is that the third rejection
was about the writing, not the code. The explanation listed "the caller knows
whether it holds the lock" as an assumption, when the contract explicitly
disclaims it: releasing a lock you never took is harmless, which is a callee
saying it does not need the caller to track ownership.

Three real contract gaps were closed on the way there and stand: the lock was
not declared at all, a write is now declared to REPLACE rather than merge, and
an append is declared to write exactly the bytes handed over, terminator
included.

What to do about it: nothing to the code. Re-sweep this one seam and write the
assumption list more carefully.

### Modules whose boundary could not be stated

None — not applicable to a seam sweep.

### Modules that are explainable but do more than one job

None — not applicable to a seam sweep.

## A defect this sweep found, outside the ledgers

The first bug five sweeps have produced, and it is fixed:

**The stop-boundary hooks wrote the run's record without holding the lock.** A
write replaces rather than merges; `next` holds the lock across a lap that can
run a gate for seconds; the hooks fire whenever any turn ends in the same
directory. A hook landing mid-lap erased that lap's phase transition and
attempt increment. The lock protected `next` from `next` and from nothing
else, in a tool built for several agents in one directory.

Fixed: every hook write now takes the lock, re-reads under it, and applies its
change to what was on disk; a held lock means the hook changes nothing and
lets the turn end. Three tests pin it. `CHANGELOG.md` carries it as a fix and
ADR-0004 as the rule.

Nothing in the seam question aimed at concurrency. What surfaced it was the
instruction to write down what the callee assumes the caller has already done.

## What this sweep changed

Seventeen declarations across six module headers. Every one was already true;
none changed behaviour. Two were corrections rather than additions —
`render.ts` claimed it "must NOT know about … state" while reading it, and
`gate.ts` said "Both" of three jobs.

## What this sweep did not look at

- **Any module's own boundary, and any function.** Those were swept earlier,
  against earlier states of the code; the seventeen declarations added here
  are newer than any of those verdicts.
- **The three type-only edges** — `gate>workflow`, `render>engine`,
  `render>state`. Deliberate: they share a shape, not a behaviour.
- **Anything outside `src/`.** No test, no workflow file, no script.
