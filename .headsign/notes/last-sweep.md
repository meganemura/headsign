# Fitness sweep — the module cli.ts

## What was swept

**the module cli.ts** — its boundary, not its parts.

This certifies that one module's boundary and nothing wider. No other module
in `src/` was looked at, and neither were `cli.ts`'s own functions: a module
whose boundary explains itself is never opened.

## The verdict

**Passed**, on the first attempt, in 7 laps. Nothing was left unexplained, no
module's boundary went unstated, and nothing was found to describe more than
one job.

## The findings

### Functions nobody could explain

None. No function was examined — see the last section.

### Modules whose boundary could not be stated

None. `cli.ts` was approved before any rejection.

### Modules that are explainable but do more than one job

None. `cli.ts` dispatches six commands, which reads like several jobs and is
not: one sentence covers them without stretching — it reads the words after
the program's name, does the one thing they ask for, prints an answer, and
ends the process with a number — and its exclusion half excludes real things:
it never works out where a run goes next, never knows what a workflow file may
contain, never judges whether checks passed.

No change is recommended to `cli.ts`.

## What this sweep did not look at

- **Five modules** in `src/` have still never been swept at all: `render.ts`,
  `state.ts`, `workflow.ts`, `engine.ts`, `stophook.ts`.
- **Every function inside `cli.ts`** — around twenty of them. The boundary was
  approved, so the sweep never went in. Nothing here says whether any of them
  can be explained.
- **Three parts of the workflow itself**, still never executed across two
  module sweeps: the descent into a module, and the two ledgers that only the
  descent or an unfocused verdict can write. Two green runs do not show that
  machinery works.
