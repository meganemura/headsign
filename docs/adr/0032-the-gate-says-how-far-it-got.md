# ADR-0032: The gate says how far it got

- Status: accepted
- Date: 2026-08-25
- Amends [ADR-0002](0002-single-question-and-output-contract.md): its output
  contract covers what `next` prints when it answers. This adds a second
  stream, written while `next` is still working the answer out.

## Context

A gate runs its checks in order and prints nothing until the last one
finishes. `runGate` calls `spawnSync` in a loop, and `cli.ts` writes the
verdict once, after the loop returns. A gate that takes a second hides that
silence. A gate that takes fifteen minutes is that silence.

Field use found the edge. A caller with a ten-minute limit on one command ran
`headsign next` against a gate of twelve checks. The command was cut off with
no output at all. From that the caller could learn none of three things: which
check was slow, how many checks the gate holds, and whether the interrupted lap
had spent an attempt.

The third already has an answer, and it is a good one. `step()` adds the
attempt and `writeState` puts it on disk, and both run after the gate returns,
so a process killed inside the gate has written no attempt. The lock is safe
too — `acquireLock` replaces a lock whose holder process is gone. An
interrupted lap costs nothing and leaves nothing to clean up. All of that is
true today, and none of it is visible.

The first two have no answer anywhere. Nothing headsign prints, before a lap or
during one, says how many checks a gate holds or which of them have run.

## Decision

**1. While the gate runs, headsign writes one line per finished check to
stderr.** One line first, naming how many checks the gate holds, then one line
for each check that finishes:

```
--- gate: 12 checks ---
--- check 1/12 passed: typecheck (2.1s) ---
--- check 2/12 passed: tests (48.3s) ---
--- check 3/12 failed: acceptance matrix (3.2s) ---
```

The gate stops at the first failure, so at most one line from a gate says
anything but `passed`, and it is the last one. The word it carries is `passed`, `failed`,
or `timed out`.

A caller that stops waiting has read the lines written so far. The count in the
first line and the index in the last one together say where the gate stood.

**2. The lines go to stderr, and the stream is forced rather than chosen.**
Line 1 of `next` on stdout is the token, and ADR-0002 makes it the contract. A
progress line on stdout would arrive ahead of the token, where anything reading
that first line would meet it instead. stderr already carries what `next` writes
when it refuses a lap, so the stream is one headsign uses.

**3. A check that produced an exit code gets a line, whichever way it went.**
The first draft of this decision gave a line to a passing check only, on the
ground that stdout reports a failing one in full. That holds on a `RETRY` and on
an `on_fail`-routed `ADVANCE`. It is false on the three paths where a failure
ends the run: `max_attempts` exhaustion, `on_fail: escalate`, and
`on_fail: $end`. All three null `last_failure`, and what stdout then prints is a
reason or a completion — no check name, no command, no exit code, no output. A
phase with `max_attempts: 1` would have named its failing check nowhere at all,
which is the silence this record exists to remove.

`gate.ts` cannot tell which of those paths a failure will take. `engine.ts`
decides that after `runGate` has already returned, so a line conditional on the
path is not one this module could write. The unconditional line is the version
that closes the silence, and it is the simpler rule to state.

**A timeout says so, in a word of its own.** ADR-0021 §4 counts a timeout as an
ordinary failure for routing, and that is untouched — but this line is the only
report of the check on the three run-ending paths above, and `failed (120.1s)`
would read as an ordinary failure that happened to take two minutes.
`render.clause` keeps the two apart everywhere else it reports a failure, and a
line that is sometimes the sole report cannot afford to blur what the fuller
report distinguishes. So the word is one of three: `passed`, `failed`, or
`timed out`.

The number beside `timed out` is elapsed time at the kill, which lands at the
limit. Nothing measured how long the check wanted, and nothing here claims to.

**A check that produced no exit code gets no line.** headsign refuses the lap
on it (ADR-0021 §2), and the refusal names the check and the command it could
not run, so a progress line would repeat what the refusal already says.

**4. The lines are unconditional.** No flag turns them on. A flag reaches the
reader who already expects a slow gate, and the reader who needs these lines is
the one who did not.

**5. `gate.ts` decides when to report, `render.ts` writes the words, `cli.ts`
writes to the stream.** `runGate` takes a function and calls it, and never
learns what the function does. `engine.ts` passes that function through and
reads nothing from it, which holds its rule that every answer leaves as data.

**6. What an interrupted lap costs is written in the reference, not in the
output.** A reader wants it before they cut a command off. A line printed on
every lap is read on none of them.

## What is deliberately not being done

**A `--dry-run` that lists a gate's checks without running them.** The first
progress line answers that question a moment later, out of the lap that is
really happening. A read-only path beside it would be a second answer to one
question, and two answers can disagree.

**Running a gate's checks in parallel.** They run in order, and a workflow may
write a check that depends on the order. Parallel execution would take that
from every workflow to shorten some.

**Reporting how long a timed-out check wanted to run.** The check was killed at
its limit, so nothing measured that, and no number here is offered as it. What
the line carries is elapsed time at the kill.

**A threshold that reports a slow check.** headsign holds no budget measured in
time (ADR-0017), so a report of that kind would need a limit invented for it.

**A progress line for the `ready:` probe or for an `on_pass` route's `when:`.**
Each is one command, and the gate is what this record is about: the probe runs
before the gate and the routes run after it, so neither is part of how far the
gate got. Some of them are already named elsewhere — `PENDING` names the probe
that answered no, and a routed `ADVANCE` names the `when:` that matched. For a
probe that passes, and for a `when:` that runs without matching, this record adds
nothing.

## Consequences

`next` writes to stderr on a lap that succeeds, which it never did before. On
any lap that reaches the gate, a caller that merges the two streams and reads
the first line — `headsign next 2>&1 | head -1` — reads a progress line from
now on. The token on stdout has not moved, so
[ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md)'s
contract holds; a caller that merged the streams was depending on an empty
stderr, which no record ever promised. The skill this project ships tells an
agent to read the token off line 1, and that instruction now names the stream it
means.

A gate of one check writes two lines where it wrote none — one naming the size,
one for the check — and a gate whose only check cannot be run writes just the
first. Every lap that reaches the gate pays that, and what it buys is a record
of what the gate examined and what each check cost. Every guard ahead of the
`runGate` call answers without printing any of it, wherever in the lap that
guard sits.

A refusal that comes after the gate has started does print these lines, and
that is the report working rather than leaking: it says how far the gate got,
and on those laps the gate really did get that far. A check that could not be
run at all refuses the lap once the gate line is already written, so that
refusal arrives under one, and the ordering is pinned by the test that covers
it. A `when:` that cannot be evaluated refuses after the gate has passed in
full, so a complete block of lines precedes it.

The duration in each line is the same measurement `gate.ts` already takes for a
failing check — one monotonic clock reading, seconds to one decimal — so every
check that finishes reports its time the same way.
