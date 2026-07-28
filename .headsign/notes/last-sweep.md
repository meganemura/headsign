# Fitness sweep — `src/gate.ts`

- Date: 2026-07-28
- Swept set: `src/gate.ts`, four functions. **This certifies that module and
  nothing wider.**
- Explained: 4 of 4 — `runGate`, `isReady`, `resolveRoute`, `buildTail`
- Unexplained: none
- Rejections along the way: 1 (`buildTail`, cleared on attempt 2)
- Laps: 18

**Verdict: `src/gate.ts` passes.** No function in it defeated a plain
explanation.

## The one rejection, and why it was not a code finding

`buildTail` was rejected on its first attempt for two faults, both in the
writing:

- It described the truncation marker by its meaning ("a line saying the output
  was truncated") instead of showing the string, so the returned value could
  not be predicted.
- It claimed `(no output)` was "exactly those nine characters". It is eleven.

The judge's second point is the more useful one: an inaccuracy inside an
otherwise exact description costs more than vagueness, because the reader can
no longer tell which half of any sentence to trust. Attempt 2 showed both
literals verbatim and was approved. Nothing about `buildTail` itself needed to
change.

## What the pilot verified about the workflow

This was `fitness.yaml`'s first execution — it had been validated and never
run. Every mechanism it stacks assumptions on behaved as designed:

- **The judge writes its own verdict.** Four subagents, four verdict files
  written by the judge rather than reported back and transcribed. This is the
  middle rung of ADR-0007 working as intended, and it was the assumption most
  worth testing, since it depends on subagent behaviour rather than on
  anything the YAML can enforce.
- **`grep -qx -e APPROVED -e REJECTED` matched real judge output** every time,
  including the rejection, whose note ran to several paragraphs below the
  verdict word without disturbing the check.
- **The rejection edge routed back to `explain`** and the try counter reached
  2 in a real loop.
- **`clear:` fired where it should**, including `current` and `explain.md` on
  re-entering `explain` after the rejection, which forced a rewrite from
  scratch rather than a patch of the sentence the judge complained about.

## What it did not test

The give-up path. No function reached three attempts, so the `-ge 3` route to
`record` and the `unexplained` ledger have still never executed. The
`report`-escalates-on-a-non-empty-list branch is likewise untested.

## Open work this pilot does not address

Recorded in `.headsign/notes/fitness-budget-plan.md`, from the `design-grilling`
run that preceded this one. Four gate changes remain unapplied because
`improve` may not make structural changes: a try counter that can tell a fresh
attempt from a stale file, a `report` check that the queue was really emptied,
a durable gated output for `report`, and an `improve` check that the notes
actually changed. Two non-structural fixes from that plan were applied during
this run's `improve` phase — `inventory` now asks for one module, and the
comment under `limits:` states the scope its number assumes.
