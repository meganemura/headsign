# ADR-0017: Three budgets, one of which can fire on a healthy run — the global ceiling escalates without ending the run

- Status: accepted
- Date: 2026-07-28
- Revises: [ADR-0002](0002-single-question-and-output-contract.md) — the
  transition table's `limits.max_total_iterations` row, and the exception this
  decision creates in "`next` is idempotent on terminal states".

## Context

A workflow that sweeps a queue (`.headsign/fitness.yaml`, one function of
`src/*.ts` per lap) raised a question its author expected to be about
control flow: what should happen when `limits.max_total_iterations` is
reached mid-sweep, with the queue half empty and the run's two output files
unwritten? The candidates were a `limits.on_exhausted: <phase>` field, a
`finally` block, and a route that reads the remaining budget.

The question dissolved instead of being answered, because it was framed on a
category that turned out not to exist. A run has three budgets, and they were
being treated as one kind of thing:

- **A counter the workflow keeps for itself** — in `fitness.yaml`, the file
  `.headsign/tmp/tries`, incremented while a judge keeps answering REJECTED
  for the same function. It counts **successful laps**: the gate was
  evaluated, a verdict was written, the verdict said no. Running out is a
  *result*, and it routes to a destination the author declared on the pass
  path (ADR-0011). From headsign's point of view nothing was exhausted at
  all — no budget of headsign's was even touched.
- **`max_attempts`** counts **gate failures** for one phase. Running out
  means the agent cannot satisfy that phase's checks: genuinely stuck.
  ADR-0014 fixed this to always escalate, and its reasoning — "a spent budget
  is the canonical moment to ask [a person]" — is exactly right here.
- **`limits.max_total_iterations`** counts **every lap**, a mixture of the
  two. A queue-sweeping run spends most of its laps on the first kind: passes
  and rejections that are the workflow working precisely as written.

So of the three, only the global ceiling can fire on a run that is doing
nothing wrong. It is not a diagnosis; it is a declared size, and reaching it
says the run turned out to be bigger than the number someone typed.

Today reaching it writes `status: "escalated"` to `state.json`, which by
ADR-0002 makes the run terminal: `next` reprints the same answer for good.
Raising the number afterwards changes nothing, `.headsign/tmp/` is wiped by
the next `start`, and everything the run had produced but not yet written to
a durable path goes with it. The person who is asked *"is this run worth more
laps?"* has no way to answer yes.

## Decision

**`limits.max_total_iterations` answers `ESCALATE` without ending the run.**
`checkIterationLimit` returns an outcome and no state: nothing is written, so
`status` stays `running`. A person who raises the limit in the workflow file
and runs `headsign next` continues from the same phase, with the same
attempts and the same scratch directory.

Three things about it are deliberately unchanged:

- **The check still runs ahead of the gate**, so a run standing at the wall
  spends no iteration and no attempt however many times it is asked. That is
  what keeps the ceiling a runaway backstop: a loop that keeps calling `next`
  makes no progress past it and can never wear it down.
- **The answer is still `ESCALATE`, exit 2.** The run has stopped and a
  person is being asked. That the question is now answerable does not make it
  less of a question.
- **The other two escalations stay terminal.** `max_attempts` exhausted and
  `on_fail: escalate` both still write `status: "escalated"` and end the run.

**The reason string names the way out.** A wall with nothing written on it is
one a person cannot act on, so the message says where the limit is written
(the run's own `workflow_path`), that `headsign next` continues from this
phase, and that `headsign abort <reason>` ends the run instead:

```
ESCALATE build: max_total_iterations (15) reached — the run is still open:
raise limits.max_total_iterations in .headsign/workflow.yaml and run
`headsign next` to continue from this phase, or run `headsign abort <reason>`
to end it
```

(One line in reality: the reason is the tail of ADR-0002's line-1 token line
and the body of one `.headsign/log` record, and a newline would split both.)
Reading `workflow_path` off the state keeps `engine.ts` as pure as it was —
no clock, no I/O.

**The log gets a fourth word: `ceiling`.** `escalate` in `.headsign/log`
means "the run ended by escalation" for its two remaining producers, and
this event ends nothing. A reader of a log that stops at a `ceiling` line —
or one that carries on past several of them — must not be told a run ended
when it did not, so the event is logged under its own name (ADR-0004 carries
the vocabulary). Repeated `next` calls at the wall repeat the line, which is
kept rather than deduplicated: each is a real request that was really
refused, and how long a run sat at the wall is part of what the log is for.

### Why ADR-0002's contract may take this exception

ADR-0002 says `next` is idempotent on terminal states, and the friction of
revisiting that contract is deliberate. What pays for it here is that the
exception is a line with a reason on both sides of it, not a special case.

There are three producers of `ESCALATE`. Two of them mean *something is
wrong* — an agent that cannot pass a gate, a failure route that says stop and
ask. Those end the run, and should: the answer to "what now?" is not a number
someone can raise. The third means *this run was bigger than declared*, and
its answer is a number someone can raise. The recoverable one is exactly the
one whose question has an answer the person being asked is able to give.

The terminal-state rule itself is untouched in its own terms: a run whose
`status` is terminal still reprints its outcome forever. What changed is that
the ceiling no longer makes a run terminal. And the safety property that rule
protects — "when in doubt, run `headsign next`" is always safe — survives,
because the ceiling answers without moving the run: asking again at the wall
costs nothing and changes nothing.

### Relationship to ADR-0014

This does not revive `on_exhausted:`, which ADR-0014 removed one day earlier,
and it does not weaken that ADR's claim. ADR-0014 argued that a spent budget
is the canonical moment to ask a person, and against a field that let an
author decide *at authoring time* not to ask. Both still hold: the ceiling
still asks, at run time, in the same words and with the same exit code. The
only thing that changed is that the person being asked can now say "keep
going" as well as "stop".

## Alternatives considered

**`limits.on_exhausted: <phase>` — route to a named phase when the ceiling is
reached.** Rejected on three counts. It revives a field name ADR-0014 removed
the day before, for a mechanism that is not the one that was removed — a
confusion that costs more to explain than the feature is worth. It also
answers only one of the two doors the original question had (the ceiling),
leaving `max_attempts` exhaustion routed elsewhere or not at all. And it
needs one-shot state of its own: the named phase is entered while the run is
still at the ceiling, so its own laps would hit the same wall and route to
the same phase again unless something remembers that the exit has already
been taken.

**A general `finally:` block.** Rejected because it means entering a phase
that no gate sent anyone to. Every non-gate transition headsign has today
moves toward a terminal state; a phase that runs "on the way out" is a
different execution model, not an extra field, and the two would have to be
explained together forever after.

**A `when:` route that reads the remaining budget.** Rejected because there
is no interface to depend on. `status` does not print the lap count, and the
two places the number exists — `state.json` and the log's `i=` field — are
internal formats nobody promised to keep. It also writes the limit twice (in
`limits:` and in the predicate), and it fails in the worst available way:
when the format moves, the predicate quietly stops matching and the run sails
past the exit that was supposed to catch it.

**Raise the number instead.** Rejected as a general answer, though it is
often the right specific one: it is the thing this decision makes possible
*after* the wall is reached, rather than a guess made before the run starts.
Picking a bigger number up front just moves the same cliff further out.

## Why there are three and not five

*(Added 2026-07-30, after the question came up from outside: current writing on
agent execution asks for tokens, money, wall clock and tool permissions to be
budgeted state.)*

The three budgets share a property that is easy to miss because it is
structural rather than stated: **headsign can count each of them itself, inside
one `next`, without asking anyone.** Attempts and iterations live in the run's
own record; a check's runtime is measured by the process that spawned it.

Tokens and money it cannot count, and the reason is ADR-0001's first principle
rather than an omission — headsign does not run the model, so a lap has no way
to learn what the turn before it spent. Tool permissions are the same boundary
seen from the other side: headsign grants nothing, the harness does. Where
those numbers do exist they belong to the harness, and a check can be pointed
at them by whoever wants that; the coupling to one vendor's interface then
lives in that repository, which is where it should be. (Reading a harness's
transcript files directly is not the way to do it — Claude Code documents that
format as internal and liable to change on any release.)

Wall clock is the one headsign could count and doesn't. `.headsign/log`
timestamps every transition, so the number is already there. Leaving it out is
a judgement, not a boundary: a slow run is not a wrong run, and the ceiling
counts laps because a lap is what the loop spends, where seconds are a fact
about the machine and the model. If that judgement turns out wrong it is the
cheapest of the three to revisit, which is the other reason to write it down
here as a judgement rather than let it look like an oversight.

## Consequences

- A run can now be continued past a ceiling it was going to die at, and the
  decision is made by the person best placed to make it, at the moment the
  evidence exists. Nothing is inferred: raising the limit is a file edit
  someone makes on purpose.
- A run standing at the wall is still `running`, so the stop-boundary hooks
  still nudge its driver back to `headsign next` (ADR-0006). That is correct
  — the run genuinely is unfinished — and the existing pause mechanism is the
  way out: write one line to `.headsign/tmp/stop-note` and stop again.
  `SKILL.md`'s sixth rule says so, because an agent reporting a ceiling
  ESCALATE to the user would otherwise be pushed back into the wall it just
  reported.
- `.headsign/log` gains one event word. `ceiling` and `escalate` share a line
  format, so nothing about reading the log changes beyond knowing that one of
  them is not an ending.
- `checkIterationLimit` no longer returns a state, which is the guarantee in
  its type: there is no state for it to write.
- The distinction between the three budgets is now written down. It is the
  reason a future proposal to make `max_attempts` recoverable "for symmetry"
  should be refused: those two exhaustions do not mean the same thing.

## Provenance

The three-budget distinction came out of a `design-grilling` run
(`.headsign/grilling.yaml`, 2026-07-28) and specifically out of the one
question in it that went to a person rather than to the loop. The notes are
`.headsign/notes/fitness-budget-plan.md` and
`.headsign/notes/fitness-budget-decisions.md`; the latter records the
question — *is running out of the three explain tries an abnormal ending?* —
that broke the category the whole analysis had been framed in.
