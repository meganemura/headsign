# Fitness sweep — the one seam engine.ts>state.ts, re-swept after the previous run filed it

## What was swept

**the one seam engine.ts>state.ts, re-swept after the previous run filed it.**

One relationship, and nothing else. No module's boundary, no function, and
none of the other ten seams — those were approved in the previous run and are
not renewed here.

## The verdict

**Passed**, on the first attempt, in 7 laps. Nothing was left unexplained, no
boundary went unstated, nothing describes more than one job.

## The findings

### Items nobody could explain

None.

### Modules whose boundary could not be stated

None — not applicable to a seam sweep.

### Modules that are explainable but do more than one job

None — not applicable to a seam sweep.

## Why this ran at all, and what it settles

The previous sweep filed this seam after three attempts. Nothing about the
code was wrong then and nothing changed in it since: the third explanation
claimed "the caller knows whether it holds the lock" as an assumption, when
the contract explicitly disclaims it — releasing a lock you never took is
harmless, which is a callee saying it does not need the caller to keep track.

Removing that claim, and naming the two deliberate omissions rather than
leaving them silent, was the whole difference.

So the earlier filing and this approval are both right, and the pair says
something the ledgers cannot: an "unexplained" verdict has two causes — a
contract that cannot carry what the caller relies on, or a writer who
misdescribed what the caller relies on — and only the first is a fact about
the code.

**With this, all eleven seams in `src/` are approved.**

## What this sweep did not look at

- **The other ten seams.** Approved in the previous run, against the same
  contracts, and not re-checked here.
- **Any module's boundary, and any function.** Swept in earlier runs, against
  earlier states of the code — every one of them predates the seventeen
  contract declarations the seam sweeps added.
- **One workflow change made to run this**: the coverage check now exempts a
  single-seam queue, so a targeted re-sweep no longer costs ten
  already-approved items. Nothing tested that exemption except the four
  predicate cases run by hand before starting.
