# ADR-0021: A command that never ran is not an answer — in all three places headsign runs one

- Status: accepted
- Date: 2026-07-30

## Context

A lap of `headsign next` runs shell in three places, and every one of them can
come back with no exit code at all — the command was never started, or this
runner killed it before it finished. Until now the three answered that
situation in three different directions.

- **A route's `when:`** stopped the run: exit 3, transition nowhere. ADR-0011
  argued it out — a nonzero exit is an answer ("not this branch"), a command
  that never ran is not, and the thing being decided there is the destination
  itself.
- **A gate check** was reported as an ordinary gate failure. `gate.ts` said
  in a comment that it should not be — "a headsign-level failure, not the
  check's own nonzero exit, and must be reported unambiguously as such, not as
  a RETRY-worthy fail" — but the value it returned carried `pass: false`, and
  the value is what `engine.ts` reads. So the lap spent an attempt on it, and
  `max_attempts` of them later the run ended in `ESCALATE`; a phase with
  `on_fail: <phase>` moved the run somewhere on the strength of it.
- **A phase's `ready:` probe** failed toward evaluating: any spawn error, the
  probe's own timeout included, was read as "ready" so the gate would run.

The middle one is the defect. `.headsign/notes/what-headsign-protects.md` #2
states the rule the routing question already obeyed — *a condition that could
not be evaluated is not a "no"; stop rather than take a default nobody declared
for that situation* — and a transition decided by a command nobody got an
answer from is exactly what ADR-0001's second principle says headsign does not
do.

## Decision

**1. Three outcomes, and the third is not a kind of failure.** `runGate`
returns `pass` / `fail` / `unrunnable`, and `isReady` returns `ready` /
`not-ready` / `unrunnable`, in the `kind:`-discriminated shape `resolveRoute`
already used. `fail` is an answer: the check ran and said no, which is what a
gate is for. `unrunnable` is the absence of one.

**2. An unrunnable command refuses the lap (exit 3) and moves nothing.**
State, log, the phase's attempt count and `total_iterations` are all exactly
what they were before the lap — the same treatment ADR-0011 gave an
unresolvable route, and what makes the message's "run `headsign next` again"
honest advice rather than a resumption mid-transition.

**3. `step()` takes a `GateVerdict`, not a `GateResult`.** The `unrunnable`
arm is excluded by the type, so "the transition function is never handed a
non-answer" is a fact the compiler keeps rather than a comment asking the next
caller to remember it. A caller has to deal with the third arm before it can
call `step` at all.

**4. A timeout stays a verdict.** The command ran; being stopped is a report
about the work; and the limit it ran past is one the workflow author wrote in
that same file. Only "headsign never got an answer at all" is `unrunnable`.

**5. The readiness probe keeps its one lenient arm.** A probe that times out
still resolves to "ready", so the gate runs and produces a real verdict — the
existing reasoning, that a slow probe must not stall a run behind `PENDING`
forever, is untouched. That leniency was never about a probe that could not be
*started*, which produced nothing to be lenient toward.

## Alternatives considered

**Keep it a failure, but don't count the attempt.** The smallest possible
change, and it fixes the accounting. Rejected: the accounting is not the whole
harm. A phase with `on_fail: <phase>` would still *move the run* on the
strength of a command that never ran, and a "failure that doesn't count" is a
fourth semantics for the failure path that nobody asked for and every reader
would have to learn.

**Answer `ESCALATE` instead of exit 3.** It reads as the more serious
response, and a person does have to look. Rejected: `ESCALATE` means the work
needs human judgment, and it is part of `render.ts`'s outcome contract. This is
a broken invocation — the same class as an unknown command or a workflow that
no longer defines the current phase — which is precisely what exit 3's
deliberately unceremonious `ERROR:` channel is for. It also resumes
differently: fix the command and ask again, with no verdict to hand back.

**Make a timeout unrunnable too.** Tempting for symmetry, since both arms
originate in the same `result.error`. Rejected under §4: a timeout is the one
`error` that carries information about the work, and the timeout that produced
it is authored in the workflow. Treating it as a headsign-level fault would
take the only tool a workflow has for capping a hung suite and turn it into a
configuration error.

**Make the probe's timeout unrunnable.** Rejected under §5, and worth naming
because it is the one place this record leaves an asymmetry standing on
purpose. The probe defers the gate; it does not choose a destination. Failing
toward "run the gate and get a real verdict" is a safer failure mode than
either stalling or refusing, and nothing about a command that could not be
started argues for it.

## Consequences

- **Three situations in a lap now produce exit 3, and they are one idea**:
  the workflow no longer defines the current phase, a command headsign needed
  could not be run, and a route that could not be resolved. All three are
  "headsign cannot judge this" — as distinct from every outcome in
  `render.ts`'s contract, which are all judgments.
- **A broken check stops the run loudly instead of burning its attempts.** The
  message names the check, its command, the errno, and the file to fix it in.
- The three-way union touched every construction of a gate result in the tests.
  That churn is the price of modelling the third outcome as a third outcome
  rather than as a decorated failure.
- `gate.ts`'s header now states the shared rule once for all three questions it
  answers, instead of leaving it in the ADR that argued it for one of them.
