# Fitness sweep — the five modules of src/ not yet swept: engine.ts, state.ts, workflow.ts, render.ts, stophook.ts

## What was swept

**the five modules of src/ not yet swept: engine.ts, state.ts, workflow.ts,
render.ts, stophook.ts** — their boundaries, not their parts.

This certifies those five boundaries and nothing wider. With the two earlier
sweeps of `gate.ts` and `cli.ts`, every module in `src/` now has a stated
boundary — but no module's functions have ever been examined by this design,
because a module whose boundary explains itself is never opened.

## The verdict

**Passed.** All five approved. Nothing was left unexplained, no boundary went
unstated, and nothing was found to describe more than one job.

Three needed a second attempt — `engine.ts`, `workflow.ts`, `render.ts`.
`state.ts` and `stophook.ts` landed first time. 25 laps.

## The findings

### Functions nobody could explain

None. No function was examined.

### Modules whose boundary could not be stated

None.

### Modules that are explainable but do more than one job

None.

## Three sharp edges, found while explaining rather than by failing

These are not failures of the fitness function — every module passed — but
they were invisible until somebody had to write down what a caller can
observe. All three are in `engine.ts`, all three were confirmed by running
them, and **none is reachable through the command line**, which checks a run's
status first and only ever loads a validated workflow.

1. **Asking for a finished run's answer, about a run that is still going,
   returns `ABORT`** with an empty reason. The check looks for "finished",
   then "escalated", and everything else falls through to abort.
2. **Stepping a run that has already ended judges it anyway.** The count of
   judgments goes up, a fresh `RETRY` comes back, and the state handed back
   still says the run is finished — a state that disagrees with itself.
3. **A destination naming a phase the workflow does not define throws**, while
   reaching for the missing phase's instructions.

Whether any of them is worth changing is a judgment for a person. The honest
description is that `engine.ts` is the rules and not the doorman: it trusts
that its caller has already checked, and today that trust holds everywhere it
is relied on.

## What this sweep did not look at

- **Any function in any module.** All seven boundaries are now stated; none of
  the roughly 76 named functions inside them has been examined by this design.
  The earlier per-function sweep of `gate.ts` is the only function-level
  evidence that exists, and it was a different run against an earlier state of
  the code.
- **Three parts of the workflow itself**, still never executed after three
  sweeps: the descent into a module, and the two ledgers only the descent or
  an unfocused verdict can write. Twelve approvals and five rejections have
  not once produced a third rejection for the same item.
