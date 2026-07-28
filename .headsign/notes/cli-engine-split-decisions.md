# Decisions — splitting cli.ts and engine.ts along a better seam

## Should the lap — the ordered sequence of questions `next` asks — move out of cli.ts at all?

**Decision: yes, and it moves as one unit — the ordered sequence together with
the guards that make it safe.**

Reason, and the decisive one is not tidiness. `engine.ts` has three entry
points that each assume the run is still going and the workflow was validated,
and nothing in `engine.ts` says so. Asked a question it does not expect it
returns a silent `ABORT` for a run that is still going, judges an already-ended
run and hands back a state that contradicts itself, or crashes on a
destination naming no phase. None is reachable today — because of the order of
statements in a different file.

Enclose the guards with them and **the offending function becomes a private
helper behind its own guard: nothing outside can reach it.** The point is not
that the fault becomes visible. It stops being part of any boundary, because
no caller can produce it.

That matters because the fitness sweep approved both modules and neither
explanation lied — `engine.ts` says plainly that it trusts its caller, which
is true and complete for that module. The fault lives between two modules,
which is the one place a sweep that looks at one module at a time cannot look.

**Moving `evaluateNext` alone would buy nothing**, because the guards are not
in it: the two `status !== "running"` checks are in `cmdNext`. The unit is
`cmdNext`'s body minus the printing — read the record, check it is running,
load the workflow, take the lock, re-read, check again, evaluate, release,
return the answer. About 60 code lines.

Supporting reasons, both smaller:

- **A hazard the code already warns about disappears.** Printing calls
  `process.exit`, so the lock must be released first, and `cli.ts` releases at
  **five** separate places. A lap that owns the lock and returns an answer
  leaves nothing to remember.
- **The map becomes true.** `docs/architecture.md` says `cli.ts` must not know
  routing rules; ADR-0002 introduces its transition table as "the whole
  routing rule set" and puts the ordering inside it, annotated "(checked
  before evaluating)". So the ordering is a routing rule by the project's own
  documents, sitting in the file forbidden to hold one.

**Rejected: leave it and fix the map.** Cheap to write, and that is not the
same as cheap. A stated precondition that nothing enforces is a comment, and
this project already decided what a comment is worth beside a gate — a
description choreographs, only a gate enforces. The same logic applies to a
module's contract.

Costs accepted, stated rather than talked down:

- The lap is not pure and `engine.ts` is. Wherever the lap lands, that module
  reads the clock and the disk.
- A no-behaviour-change refactor of forty per cent of `src/`, on a tool that
  works, verified by 140 tests in a 2,565-line file that will themselves have
  to move.

And a consistency argument worth recording as such: this project retired a
line-count budget because it never stopped a decision, and replaced it with a
sweep whose purpose is to name what cannot be explained. **This is the first
finding from that sweep that costs something.** Waving it through would say
the replacement measures as little as the number did.

## Should the lap live inside engine.ts, or in a new third module beside it?

**Decision (answered by a person): into `engine.ts`, and paired with hardening
the three entry points. Not a third module.**

Reason for ruling out a third module: it encloses nothing. `engine.ts` would
keep its three exported entry points, anything could still call them, and all
three sharp edges survive — only the identity of today's caller changes. It
also takes `src/` from seven files to eight, where absorbing keeps it at seven
by moving code between two files that already exist.

**The finding that changed the shape of this question:** where the lap lives
and whether the entry points guard themselves are two independent decisions,
and the previous answer treated them as one. **Hardening** — `terminalOutcome`
refusing a still-running run instead of calling it aborted, `step` refusing an
already-ended run, and a destination naming no phase producing a
headsign-shaped error instead of a raw crash, that last check needed on both
the pass path and the failure-route path — is four checks, under a dozen
lines, and it delivers the decisive reason of the previous decision by a
different route: not by enclosure but by leaving no unexpected question to
ask.

Because a total function is safe to export, hardening also **removes the cost
that made absorbing look expensive**: `tests/engine.test.ts` keeps its 29
tests and 40 direct calls.

| | edges gone | map | lock releases | tests |
|---|---|---|---|---|
| harden only | yes | still contradictory | five | keep |
| **absorb + harden** | **yes** | **consistent** | **one** | **keep** |
| absorb + un-export | yes | consistent | one | 40 direct calls lose directness |
| third module | **no** | consistent | one | keep |

"Absorb + un-export" is dominated and drops out; so does the third module.

What the merge buys over hardening alone, and it is only these two: the
ordering sits with the rules it belongs to, so the two rows in
`docs/architecture.md` can be written without contradicting each other — note
this is *not* "the map becomes true", because `engine.ts`'s own row must change
too, since it currently forbids knowing about `child_process` and the lap
spawns the gate. And the lock is taken and released in one place instead of
five, where today a comment is the only thing keeping five exits correct.

Accepted cost: a refactor of the two largest modules with no observable
difference, verified by 140 tests in a 2,565-line file that will need
rethinking about what they point at.

## Should the other commands (start, abort, claim, status, validate) move with the lap, or stay in cli.ts?

**Decision (answered by a person): move the four that operate on a run —
start, abort, claim, status. `validate` stays in `cli.ts`, and its reason goes
into the code: it operates on a file, and its glance at the run's record is
argument resolution — deciding which file was meant when none was named,
never changed and never judged.**

Reason: leaving them gives `cli.ts` a purpose that needs an "and also" in it —
turn typed words into an operation, print the answer, set the exit code, *and
also* start runs, abort them, hand out driver seats and describe them. That is
the shape the sweep now asks every module about, and fixing one module's
contradiction while leaving the other unable to state a single purpose is a
strange use of a refactor this size.

**The cost that was missed at first, and is the largest in this decision:**
all four commands currently end by building text and calling something that
prints and exits. Moved into a module that may not format text or choose exit
codes, **each has to be redesigned to return a result the caller renders** —
four return shapes, four new branches where answers are rendered, and a
decision about whether they share the lap's answer type. This is API design,
not relocation, and "no observable difference" hides how much of it there is.

Sizes, counted. Moving start (23), the lap (38 + 23), abort (18), claim (12)
and status (31) is 145 lines, plus the helpers they need (15 + 11 + 7): about
**178**.

| | now | after |
|---|---|---|
| `cli.ts` | 313 | ~100 |
| `engine.ts` | 81 | ~260 |

For scale: `workflow.ts` 162, `render.ts` 156, `stophook.ts` 109, `state.ts`
93, `gate.ts` 69. `engine.ts` becomes the largest by more than half again,
where today's largest sits among peers.

**One property is preserved that looked at risk:** the moved module need not
read the clock. `stophook.ts` already writes log lines while taking the
timestamp as a parameter, and the same shape works here. No clock is half of
what makes the existing transition tests cheap.

Accepted risk, stated rather than argued away: "everything that touches a run"
is how a module becomes a grab-bag under a respectable name, and the size
makes that easier. **The check is direct** — run the fitness sweep over both
modules after the move. If the unifying sentence ("performs one operation on a
run and reports what happened, without deciding how to say it") holds, a judge
that has read only the explanation says so; if it is a list wearing a
sentence, the same judge has three times this week named exactly where the
reader lost the thread.

## Should the module that owns the lap also own the lock, so cli.ts never holds it?

**Decision: yes, with a structural release as a condition rather than a
preference — `try { … } finally { release }` around the whole body, one
acquire at the top.**

Reason, and it is not the one this was first argued on. If `cli.ts` keeps the
lock, the moved lap gains a precondition nobody writes down: *call me only
while holding a lock you took in a different module.* That is the same shape
as the three sharp edges — a requirement satisfied by the order of statements
in another file, stated nowhere near the code that depends on it. Finishing a
refactor undertaken to remove that shape by creating a fresh instance of it
would be an odd result.

**Correction to the record: forgetting a release is not a hazard.** Every exit
that skips one ends the process a moment later, so the lock file belongs to a
dead process; the next run finds the holder dead, deletes the file and
retries successfully. `releaseLock` is also safe to call when not held — it
compares the id first and catches everything. Forgetting costs one extra file
operation on the next run.

**That reduces one of the two benefits the earlier decision to absorb was
priced on.** The lock cleanup is tidiness, not a hazard removed. That decision
stands, because what actually carried it was that `cli.ts` otherwise cannot
state a single purpose — an independent argument — but the record should not
keep claiming more than is there.

If the lap instead ends with four early returns and four releases, five have
become four and the comment guarding them moves house: the same fragility with
a new address, worth nothing. Hence the condition.

One decision travels with the code: **the lock is acquired after the workflow
is loaded**, deliberately, because parsing widens the window in which another
process could act.

## Should engine.ts stay a pure function with no files, no shell and no clock?

**Decision: no as a module — and its row says so. Two properties are kept
deliberately and written where they actually belong.**

Reason: once the lap and four commands move in, the module spawns the phase's
shell commands and reads and writes the record and the log. Claiming purity
would put a false line in the map, which is the failure this refactor exists
to correct.

What that costs at project scale, counted: exactly two modules have no
reference to the filesystem, spawning, the process object or the clock today —
`engine.ts` and `render.ts` (whose only matches are comments saying it never
calls the clock). Everything else ranges from `workflow.ts`'s single file read
to `cli.ts`'s 24. After the refactor there is **one** side-effect-free module
rather than two. A reduction, not a collapse, and the survivor is the one that
owns the output contract.

Kept, and stated at the right scope:

- **The transition function stays pure and exported.** Same four values, same
  answer. Hardened, so exporting is safe, so `tests/engine.test.ts` keeps its
  40 direct calls and the exhaustive enumeration of the transition table
  survives. The property demotes from a claim about the module to a claim
  about one function in it.
- **The module never reads the clock.** A timestamp is passed in. Two live
  precedents: `render.ts` composes every log line with no clock in its code,
  and `stophook.ts` passes one across a module boundary. Byte-identical log
  lines for the same inputs is what lets a test assert on a whole line.

**New requirement found here: hardening covers three entry points, not two.**
The allowance check has a precondition too — asked about an already-ended run
it compares counts and can answer "escalate" about a finished run. Today it is
only reached after the running check. Left exported and unhardened after the
move it becomes a fourth sharp edge: the same shape, newly reachable,
introduced by the refactor meant to remove it.

## Does this decomposition actually fix the three sharp edges in engine.ts, or only move them?

**Decision: neither — it does nothing to them. Hardening fixes them, and needs
no refactor. The count is four, not three. And the move adds one new risk that
must be closed by construction.**

Reason: an edge is reachable because the function is exported and can be
called with a state it does not expect. The move would change that only if the
entry points stopped being exported, and an earlier decision deliberately kept
them exported so the transition-table tests keep their 40 direct calls.
Exported before, exported after — same callers, same inputs, same answers.

**The fourth edge**, found by walking the exported surface one name at a time
rather than by reading an explanation: asked about a run that has already
finished, the allowance check compares the count against the limit and answers
`max_total_iterations (2) reached — the run is still open: raise
limits.max_total_iterations … and run headsign next to continue`. "The run is
still open" about a completed run. Not a crash, not a wrong number — a false
sentence offered as guidance. Verified by calling it. It was exported and
unreachable today for the usual reason: the running check happens first, in
another file.

Worth noting how it escaped: a boundary explanation reports what a reader
could not predict from the text, not an audit of every exported name. Second
time this week the sweep's shape has bounded what it can find.

**The new risk the move adds, and it is on the ordinary path.** All four
moving commands guard themselves, but every guard refuses by calling the
helper that prints to the error stream and exits 3. In a module that may not
choose exit codes, each refusal becomes a returned value `cli.ts` maps back to
an exit 3 — and a missed mapping means an error printed with **exit 0**, a
silent wrong answer to any script that checks. Preventable rather than
inherent: one discriminated refusal kind, switched exhaustively, so the
compiler will not build with a case unhandled. That is a condition of the
work, not a hope about it.

**Consequences carried forward:**

1. **Do the hardening first, as its own change** — so the refactor is verified
   against a codebase where those four points already have defined behaviour,
   rather than moving code whose behaviour at four inputs is undefined and
   then having to decide whether a difference was intended.
2. **Refusals become one discriminated kind, switched exhaustively.**
3. **The refactor's justification must be restated to whoever authorised it**,
   because part of what it was sold on is bought by something else and far
   cheaper. Its remaining case is exactly two things: `cli.ts` cannot
   otherwise state a single purpose, and the ordering sits in the file the map
   forbids to hold it.
