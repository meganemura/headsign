# ADR-0018: The seam between `cli.ts` and `engine.ts` — the order of a lap is a routing rule, so the five run operations move

- Status: accepted
- Date: 2026-07-28

## Context

One `headsign next` needs five things done:

1. read the word "next" and know what it refers to;
2. check that a run exists here and is still going;
3. ask a fixed sequence of questions — total-iteration ceiling, then the
   `ready:` probe, then the gate, then the branch;
4. decide what the gate's answer means for the run;
5. put that into words and attach an exit code.

The file names, both module headers and the module map in
`docs/architecture.md` all said `cli.ts` = 1 and 5, `engine.ts` = 3 and 4.
What the code did was `cli.ts` = 1, **2, 3**, 5 and `engine.ts` = 4. Two of
the five jobs were in the wrong house.

Job 3 is the one that matters, because **the order is itself a routing
rule**. ADR-0002 introduces its transition table as "the whole routing rule
set" and puts the ordering inside it — the ceiling row is annotated
"(checked before evaluating)", and the `ready:` note says the probe is
evaluated before the gate and never inside `step()`. By this project's own
documents, then, the sequence was a routing rule living in the one file the
map forbids to hold one. Job 2 travels with it: the guards are what make job
3 safe to run at all, and they were the reason the same order could not be
asked in a different order.

Three separate statements said the same untrue thing, which is why nobody
tripped over it: the file name `cli.ts`, the `// Responsibility:` header of
that file, and its row in the module map. All three said "input and output
only". A reader who believed any of them believed all three.

**Fixing it by renaming has nowhere to go.** The honest name for a module
that parses argv, holds the order of the lap, prints, and exits is "the
program" — and a module that can only be named that has no boundary to
describe. The name was not the thing that was wrong.

Six questions were worked through before this was written, and the full
record — including the ones whose first answer turned out to be wrong — is in
`.headsign/notes/cli-engine-split-decisions.md`.

### What this is *not* about

`engine.ts` had four sharp edges: `terminalOutcome` calling a still-running
run aborted, `step` judging an already-ended run, `checkIterationLimit`
telling a completed run "the run is still open", and a destination naming no
phase dying on a raw `TypeError`. Each was unreachable only because the
statements in another file happened to run in the right order.

**They are not the justification for this move, and this move did not fix
them.** They were closed by making those three entry points total — four
checks, under a dozen lines — in its own change, deliberately before this
one. That hardening needed no refactor, and this refactor would not have
fixed the edges: they were reachable because the functions are exported, and
they stay exported (that is what keeps `tests/engine.test.ts`'s 48 direct
calls into the three of them direct). Conflating the two would sell a large refactor on a benefit a
small change had already delivered.

What is left as the case for moving is exactly two things: `cli.ts` could not
otherwise state a single purpose, and the ordering sat in the file the map
forbids to hold it.

## Decision

**1. The five operations that act on a run move into `engine.ts`:** `start`,
one lap of `next`, `abort`, `claim`, `status`, together with the guards, the
helpers they need (`clearPhaseArtifacts`, `ensureHeadsignGitignored`), and
the shared "no run in progress here" message. `cli.ts` keeps argv parsing,
the clock, the printing, the exit codes, and the two hook subcommands.

**2. `validate` stays in `cli.ts`, and the reason is in the code.** It does
not operate on a run; it operates on a **file**. Its one look at the run
record decides *which file was meant when none was named* — argument
resolution — and it neither changes the run nor judges it.

**3. Every moved operation returns a value; refusals are a discriminated
kind, switched exhaustively.** All five used to end by building text and
calling something that printed it and exited. A module that may not choose an
exit code has to hand the answer back, and the dangerous half is the
refusals: each was an `errorExit` — `ERROR: <message>`, exit 3 — and a
refusal dropped on the way back becomes an error message printed with **exit
0**, a silent lie to any script that checks. That is on the ordinary path,
not an unreachable edge. So `cli.ts` maps each result arm inside a function
declared to return `never`: a missing arm makes the end of that function
reachable, and the build fails. Structure, not a promise to remember.

Two non-success kinds, because the two print differently and always did:
`REFUSED` becomes `ERROR: <message>` and exit 3, `WORKFLOW_INVALID` becomes
`render.ts`'s `INVALID:` block and exit 3.

**4. The lock moves with the lap, and its release is structural.** One
acquire at the top, `try { … } finally { release }` around the whole body, so
the five early exits that each used to need their own release call cannot
skip it. Forgetting one was never much of a hazard — the process ends a
moment later, and the next run finds the holder dead and steals the file —
but leaving the lock in `cli.ts` would have created an unwritten precondition
("call me only while holding a lock taken in another module"), which is the
exact shape this change exists to remove. The acquire stays *after* the
workflow is loaded, deliberately: parsing YAML under the lock would only make
other processes wait for it.

**5. `engine.ts` is no longer a pure module, and its row says so.** It spawns
the phase's gate through `gate.ts` and reads and writes `.headsign/`. Two
properties are kept, and are now claims about the right scope:

- **`step()` is still pure, total and exported.** Same four values in, same
  answer out, no I/O — which is what lets `tests/engine.test.ts` enumerate the
  transition table by calling it directly.
- **The module never reads the clock.** A timestamp arrives as an argument,
  the same shape `stophook.ts` already uses across this boundary, so the same
  inputs produce byte-identical log lines and a test can assert a whole line.

**6. Nothing observable changes.** No output, exit code, state.json byte or
log line differs. The end-to-end sweep (`start` → failing `next` → fixed
`next` → `COMPLETE`, plus `status` / `abort` / `claim` and each command
against a directory with no run) was captured before and after and compared:
zero difference.

### Records this touches

- **ADR-0002 needs no revision.** Its table, its ordering annotations and its
  contract are all unchanged and none of them names a module. This ADR only
  takes it at its word: an ordering inside "the whole routing rule set" is a
  routing rule.
- **ADR-0004 gets one**, because a sentence in it became false: it said
  `cli.ts` is the direct caller for every logged transition. `cli.ts` still
  captures the timestamp — the clock split that ADR describes is unchanged,
  and now has a second module on the receiving end of it.
- Where ADR-0011 and ADR-0017 say `engine.ts` is pure, read it as this ADR
  narrows it: the transition function still is, the module is not.

## Alternatives considered

**A third module beside `engine.ts` for the lap.** It encloses nothing.
`engine.ts` would keep the same exported entry points with the same callers,
so not one edge disappears — only the identity of today's caller changes —
and `src/` goes from seven files to eight where absorbing keeps it at seven.

**Move `evaluateNext` alone.** Buys nothing: the guards it depends on are not
in it. Both `status !== "running"` checks lived in `cmdNext`, so the ordering
that was the whole problem would have stayed exactly where it was.

**Leave the code and fix the map.** Cheap to write, which is not the same as
cheap. A stated precondition that nothing enforces is a comment, and this
project has already decided what a comment is worth beside a gate: a
description choreographs, only a gate enforces. The same logic applies to a
module's contract.

**Un-export the three entry points once the lap is inside.** Dominated: it
buys nothing the hardening did not already buy, and costs
`tests/engine.test.ts` its 48 direct calls into the transition table.

## Consequences

- A refactor of the two largest modules with, by design, nothing to show for
  it at the command line. It is verified by the existing 140 CLI tests
  (unchanged), the 35 tests calling `engine.ts`'s three entry points directly
  (unchanged, 36 of those calls into `step()` itself), a captured
  before/after sweep, and ten new tests that assert every refusal of the five
  moved commands as a whole `ERROR:` line with exit 3.
- **`engine.ts` becomes the largest module by a wide margin**: 100 → 314 code
  lines, against `workflow.ts`'s 162. `cli.ts` goes 313 → 210, and `src/`
  totals 1,002 → 1,113. The growth is not relocation — it is the returned
  result types and the five reporting switches, which is what "each has to be
  redesigned to return a result the caller renders" costs when written out.
- **One side-effect-free module instead of two.** Before this, exactly
  `engine.ts` and `render.ts` touched no filesystem, no spawn, no `process`
  and no clock. Now only `render.ts` does — and it is the one that owns the
  output contract, so it is the right survivor. A reduction, not a collapse.
- `engine.ts` composes `.headsign/log` lines through `render.logLine`, so it
  imports the module that owns that format. It formats nothing else: which
  event happened is the engine's to decide, how the line reads is not.
- The risk worth naming: "everything that touches a run" is how a module
  becomes a grab-bag under a respectable name, and this one is now big enough
  to hide one. The check is direct and already exists — `.headsign/fitness.yaml`
  sweeps `src/*.ts` function by function and fails on the ones nobody can
  explain (ADR-0016). If the unifying sentence, *performs one operation on a
  run and reports what happened without deciding how to say it*, holds, a
  judge reading only the explanation will say so.
- This is the first finding from that sweep that cost something to act on.
  Waving it through would have said the sweep measures as little as the line
  budget it replaced.
