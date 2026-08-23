# ADR-0031: When the run entered the phase

- Status: accepted
- Date: 2026-08-23
- Amends [ADR-0017](0017-three-budgets-and-the-recoverable-ceiling.md): its
  refusal of wall-clock time is a refusal to *count* it. Reporting one
  timestamp is a different act, and this says which side of that line `status`
  now stands on.

## Context

ADR-0017 declined wall-clock as a budget, and gave the reason: a slow run is
not a wrong run. That refusal stands and nothing here weakens it — headsign
still measures no duration, sets no time limit, and fails nothing for being
slow.

What was asked for is smaller. A viewer that draws a run wanted to show how
long each phase has been going, and had no way to find out. `.headsign/log`
timestamps every transition, and reading it is the wrong answer twice over:
it is gitignored internal state, and ADR-0004 makes `status` the one reader of
the run record. `status` itself carried two timestamps, and neither answers the
question. `last stop:` is about a turn end. `last drive` — printed as `last
moved:` — is stamped by every `start` and `next` whatever the answer was, so a
retry moves it while the run stands exactly where it stood.

## Decision

**1. `state.json` records `phase_entered_at`, and `status` prints it** while a
run is `RUNNING`:

```
entered: 2026-08-23T07:49:15+09:00 — when this run last entered the phase above
```

**2. It is stamped where `clear:` runs, and that is the whole rule.** The
schema already draws this boundary and the field borrows it rather than
inventing a second one: `on_fail: retry` stays in the phase and clears nothing,
so the stamp does not move; `on_fail: <this same phase>` leaves and re-enters,
clearing as it goes, so it does. Every ADVANCE is an entry — onward, routed, or
back to a phase the run has been in before — and ADVANCE is the only outcome
that enters one. `start` stamps the entry phase for the same reason, at the
same moment its `clear:` runs.

Writing it in one place beside that call is what keeps the two from drifting
apart. A second condition would be a second definition of "entered".

**3. The timestamp is printed and nothing is computed from it.** No elapsed
time, no threshold, no line that says a phase is taking too long. Subtraction
is the reader's, which is also the rule `render.ts` already lives by: it reads
no clock, cannot know the reader's timezone, and prints a stored timestamp
verbatim rather than reformatting it.

**4. Absent means "nothing to report", never "just now".** A run that began
before the field existed has no stamp and prints no line, the same tolerance
`last_stop` and `last_drive` already carry.

## What is deliberately not being done

**Per-phase totals, or any history.** How long the run spent in a phase it has
left is a question about the past, and answering it would make `status` a
report on a run rather than a look at where it stands. The log holds the
transitions for anyone who owns the run and wants to read their own internals.

**A duration in the output.** Printing `— 14m ago` would put a clock in
`render.ts` and a rounding decision in a line whose whole virtue is that it
restates what was recorded. It would also be the first step toward the budget
ADR-0017 refused, by making slowness something headsign has an opinion about.

## Consequences

A tool reading `status` can show time-in-phase without touching `state.json` or
`.headsign/log`. That is the same gap ADR-0029 closed for the graph pin, in the
same shape: the public surface answers, so nobody has to guess from internals.

`status`'s output for a `RUNNING` run gains a line that is present for every
run started after this release. Unlike the conditional lines around it, this
one is not rare — which is allowed, and is why
[ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md) exists:
the wording, the position and the presence of every line but the first are
this project's to change.
