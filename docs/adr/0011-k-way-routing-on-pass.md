# ADR-0011: k-way routing on `on_pass`

- Status: accepted
- Date: 2026-07-27

## Context

A headsign workflow has been a directed graph since ADR-0002: phases are
nodes, `on_pass`/`on_fail` are edges, and a shell exit code decides which
edge a run takes. Bounded cycles (`max_attempts`,
`limits.max_total_iterations`), a terminus (`$end`), a hand-back to a human
(`ESCALATE`), and state kept outside the model (`state.json`) were all
already there.

One shape was not expressible: choosing among several destinations on the
same outcome. `on_pass` held exactly one phase name, so a phase that wants
to send the work to *one of several* places — the shape a triage or intake
phase has — had to be written as a chain of phases that each pass the work
along, or not written at all. That is the whole of what this ADR adds.

The constraint every option below had to satisfy: the judgment is the
agent's, the transition is headsign's (ADR-0001, ADR-0007). No design here
may create a path where the model's text names the next phase.

## Decision

### 1. `on_pass` takes a list of routes; the string form is the one-element case

```ts
export interface Route { when?: string; to: string; timeout?: number }
// Phase.on_pass: string | Route[]
```

```yaml
on_pass:
  - when: "grep -qx fix-bug .headsign/tmp/route"
    to: fix-bug
  - when: "grep -qx write-docs .headsign/tmp/route"
    to: write-docs
  - to: implement          # no when: — the default destination, always last
```

Routes are resolved **after** the gate passes, never on the failure path.
Each `when:` runs in order, and the first one to exit 0 decides the
destination; if none matches, the last entry (the one with no `when:`)
does. `when:` is a shell command judged by its exit code — the same kind of
thing a check is, run the same way (`/bin/sh -c`, the phase's `env:`, a
`timeout:` defaulting to the same 120 seconds checks use). The field
reference for authors lives in README's routing section; this ADR records
why the shape is what it is.

The point of generalizing the field that already existed, rather than
adding a branching construct next to it, is that it introduces **no new
runtime concept**. There is no new token, no new command, no new state
field, no new file, and no new evaluation stage: the same "gate passed, now
where to?" moment resolves one destination out of n instead of out of one.
A string `on_pass` is the degenerate one-element case, and it is unchanged
byte for byte — same stdout, same `.headsign/log` line.

This extends the v1 schema recorded in ADR-0003, whose schema block shows
the string form only.

### 2. Not a per-check `on_fail`

The alternative considered was letting each check inside a gate carry its
own `on_fail: <phase>`, so a gate could fall out to different phases
depending on which check failed. Rejected for two reasons, either of which
would be enough.

**The same key would mean different things depending on where it is
written.** A phase-level `on_fail` routes a *failure*, and a failure is
counted: it increments `attempts`, it can exhaust `max_attempts`, and it is
what `last_failure` records for `status` to show. A check-level `on_fail`
used for routing would be a *successful* branch spelled as a failure — the
router phase does exactly what it was supposed to do, every time — and it
would either have to carry that accounting along (a working phase burning
attempts until it escalates) or quietly not carry it (one key, two
accounting rules, distinguishable only by indentation).

**The guard-clause spelling reads backwards.** To branch on "the route file
says fix-bug", the check has to *fail* in that case, so it is written
`run: "! grep -qx fix-bug .headsign/tmp/route"` with `on_fail: fix-bug`.
The line that mentions `fix-bug` twice means "when it is fix-bug, fail into
fix-bug", and every reader has to negate twice to see it. `when: … to: …`
says the same thing once, forwards.

### 3. Attempt accounting is not touched at all

Routing happens on the pass path, and by the time routes are resolved the
engine has already cleared this phase's `attempts` entry and its recorded
failure — that is what passing a gate has always done. So `max_attempts`,
`on_exhausted`, and `last_failure` keep exactly the meaning ADR-0004 gave
them: a route decision can neither cost an attempt nor grant one, because
there is no failure in the neighborhood of it.

A router phase whose own gate *fails* is an ordinary failing phase: RETRY
(or whatever its `on_fail` says), attempt counted, routes never consulted.
Branching adds a second question after the first one has already been
answered; it does not change the first question.

### 4. `retry` stays, because a phase name cannot say "stay"

With destinations now expressible as a list, it is fair to ask whether the
`retry` token could be replaced by naming the phase itself. It cannot,
because the two are different transitions:

| | `on_fail: retry` | `on_fail: <this phase>` |
|---|---|---|
| Meaning | stay in the phase | leave it and re-enter |
| `clear:` | not run | runs |
| `last_failure` | recorded (`status` shows it) | cleared |
| Answer token | `RETRY` | `ADVANCE` |

Both are legitimate and both are used. A self-route re-runs entry effects
on purpose — it is how a review phase throws away a stale verdict — and
`retry` deliberately does not, which is what lets an agent keep working on
the same failure with the phase's artifacts intact. Collapsing them would
silently break whichever behavior the author was relying on.

### 5. A `when:` that cannot be run stops the run (exit 3)

Exit 0 and non-zero are both *answers*: matched, did not match. A command
that could not be executed at all — a spawn error, a timeout — is not an
answer. headsign stops with exit 3 (a configuration error) and transitions
nowhere.

Falling through to the default entry was rejected because the thing being
decided here **is** the destination. Advancing to a phase that nothing
actually selected, and printing an ordinary `ADVANCE` while doing it, would
contradict the one claim the whole tool rests on: that a transition is
whatever the declared edges and the exit codes say, and nothing else. There
is precedent for the direction: `next` on a run whose phase has disappeared
from the workflow exits 3 rather than picking a plausible substitute.

`ready:` falls the other way — a probe that cannot run is treated as
"ready", so the gate is evaluated — and the two are not inconsistent. What
a broken `ready:` costs is one wait: nothing has moved, no state has
changed, and the next `next` asks again. What a broken `when:` would cost
is the run's position in the graph, arrived at by no decision. Fail toward
the side where being wrong is cheap and immediately visible.

### 6. An unreachable phase is a warning, not an error

Until now, a phase not reachable from `entry` was a validation *error*, and
`load()` returned no workflow when validation failed — so an unreachable
phase stopped `start` and `next` outright, not just `validate`. That is a
heavy answer to a condition that is usually a half-written phase or an edge
commented out for five minutes, and editing the graph is exactly what this
feature invites people to do more often.

Unreachable phases are now warnings: printed to stderr by `validate` (which
still exits 0) and by `start` (once per run, while the person who wrote the
file is present), and not by `next`, whose every-turn hot path should not
carry authoring feedback. `load()` returns `{ workflow, errors, warnings }`
to make the split explicit rather than encoding severity in a string.

This is a behavior change for existing workflows — a file that used to be
rejected now loads — and it is recorded in the changelog under Changed. It
is also why the reachability walk had to learn the list form: without
following every `to:`, every branch destination would be reported
unreachable, and the change above would have turned that false report from
a loud error into a warning nobody reads.

### 7. Still no parallelism inside a run

`when:`/`to:` picks one destination. It does not fan out, and there is no
join. One active phase per run remains the rule (ADR-0001's non-goals), and
this ADR does not weaken it: a k-way branch is a choice, not a fork.

Where parallelism is genuinely wanted, it composes one level up: one
worktree, one run — each worktree has its own `.headsign/`, so runs there
neither share nor see each other's state — and a parent run's join phase is
a phase whose gate inspects the child runs' terminal state, the same way
any other gate inspects the filesystem. headsign neither creates,
coordinates, nor aggregates those worktrees; that arrangement belongs to
whoever set it up. headsign's only contribution is that a run belongs to
the directory it was started in.

Two related things are deliberately left out of this ADR. `on_fail` gets no
list form: if the need appears, the same shape fits there, and adding it
before there is a use would be inventing symmetry rather than answering
one. Cycle detection also stays out — it is an older question that this
feature neither creates nor worsens, and `limits.max_total_iterations` is
the backstop that already catches its consequence.

## Line budget: a claim recorded so it can be graded later

ADR-0001 budgets `src/` at roughly 500 code lines and calls the number a
design smell detector, not a compiler limit. `src/` measured 984 code lines
before this change and 1081 after it — already about twice the guideline
either way — and this ADR claims no exemption from that.

What it does claim, and what should be checked rather than believed, is
that this change buys **expressiveness, not machinery**: no new runtime
concept, no new token, no new command, no new state field, no new artifact
on disk. The cost is one function that runs commands the same way the gate
already does, one optional field on the ADVANCE outcome that the renderer
reads, validation rules for the new list shape, and the warning channel
`load()` now returns alongside its errors.

Evidence that would falsify the claim, listed here so a future reader can
look for it: a follow-up feature that needs to know *which* branch was
taken beyond the log line; `when:` acquiring anything an expression
language has (variables, interpolation, combinators); a request for join or
fan-out that only makes sense because branching exists. Any of those would
mean this was machinery after all, and the next proposal should be answered
by removing something rather than by adding to it.

## Consequences

- A string `on_pass` is entirely unaffected: same routing, same stdout,
  same log line. Nothing an existing workflow prints changes.
- For the list form, ADVANCE gains one output line (`--- routed: … ---`)
  and one log detail (`routed-when="…"` / `routed-default`). The log is the
  only record of why a run took the branch it took, so it carries the
  matched command; the stdout line is for the agent reading it now.
- `src/gate.ts`'s remit widens from "run the phase's checks" to "run the
  phase's checks, and resolve which declared route matched". `src/engine.ts`
  stays pure and clock-free: it receives the resolved result and applies it,
  and still holds every rule about what a destination *means*.
- Workflows that were rejected for an unreachable phase now load with a
  warning. A workflow author who wants the old strictness has `validate`'s
  stderr output.
- A router phase makes the agent's judgment legible: the file it writes
  (`.headsign/tmp/route`, say) is a one-line artifact, the `when:` commands
  that read it are in the workflow, and the branch taken is in the log.
  The set of destinations is whatever the workflow declares — headsign
  reads exit codes, never a phase name out of a file the agent wrote.
