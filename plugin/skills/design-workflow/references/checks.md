# Checks, claims, and empty rounds

Read the section that matches the decision in front of you:

- pairing a new check with the instruction that produces what it asks for
- a claim that lives in a sentence rather than in structure
- how many phases or checks are enough
- a round that can legitimately leave a phase with nothing to produce

## A check and the instruction that satisfies it move together

**Adding a check without adding the instruction that produces what it asks for
does not create a gap — it creates a device for manufacturing compliance.** The
phase's description is all the agent is told; the gate is what it must satisfy.
Move only the gate, and the agent arrives with instructions that do not mention
the new requirement and a gate that fails until something satisfies it. What
follows is not the work you wanted: it is whatever makes the check pass. The
artifact then contains a section written to be found by a `grep`, and the run
records a pass.

So treat them as one edit. **Add a check and update the description in the same
change; if there is no description to update, the check cannot be added yet** —
that absence means nobody has decided whose job the new requirement is, and a
gate is a poor place to discover that.

**The reverse is worth checking before you build anything.** A mechanism that
prevents a mismatch is only worth its cost if the mismatch can actually occur.
It is easy to design an exclusion, a guard, or a reconciliation step for a
collision that turns out to be impossible in this workflow — and the cost is not
just the writing: every future reader has to work out what it protects. Ask
first whether the drift you are preventing is real. If it is not, the mechanism
has zero subjects, and that is worth knowing before it is in the file rather
than after.

## When the claim lives in prose

Structural checks — a table's shape, a verdict's word, a citation's form — go
green about what they read. If the thing that matters is a sentence, none of
them is looking at it. A phase can rewrite an invariant, drop half of it by
accident in the same edit, and pass a gate of three checks, because all three
were about structure and the loss was in prose. The gate was not wrong. It
answered the question it was asked.

**A green gate is not a substitute for reading what you changed**, and the
place that rule fails is exactly where it is most tempting: you changed prose
mechanically, the gate came back green, and green is faster to read than a
diff. Worth saying plainly because the alternative — expecting a shell check to
notice a missing sentence — is not available. Nothing here can report "the run
changed four files and the checks read two": headsign never learns what a
command read. `run:` is an arbitrary string, and every tool surveyed that
reports an unexamined set gets it from somewhere else — a declaration the
author wrote, an execution trace from a profiler, or a human ticking "viewed".
None of them asks the check.

**What is available is to pin the prose as a fixture and gate the comparison.**
This is the shape snapshot testing already uses, and `terraform plan` and
`cargo insta review` use it too: fix the expected text, compare against it, and
let a difference either fail the gate or land as an artifact a person has to
accept. It costs one file and no new tool behaviour. And it turns the accident
above into a red gate, because the check is no longer about the document's
shape — it is about this exact sentence still being there. Reach for it wherever
a claim you depend on is carried by wording rather than by structure.

A gate reads the tree, so a workflow tends to get written as though everything
it needs is derivable inside the run. Two phases in, that assumption is
invisible. It breaks when an answer arrives from a person — and it will arrive
mid-run, not tidily between runs, because the person answers when they answer.

**Give an arriving answer a destination of its own.** The failure looks like
this: a phase says "do not decide questions the source leaves open — an open
question belongs to the owner", which is a good rule and splits two routes
cleanly. Then the owner answers one, mid-run, and neither route can take it.
Filing it as still-open records a question that has an answer; recording it
under the phase that derives from the source describes the owner's decision as
the source's. Both routes now demand a sentence that is false. The workflow was
written for two origins — decided by the source, awaiting the owner — and the
third, *decided by the owner, and here is the record*, had nowhere to go.

**So when a phase's instruction forbids a shape, walk the legitimate cases and
check each one has somewhere to land.** A prohibition with no exit does not
stop the case arising; it makes whoever meets it choose between stopping and
writing something untrue, and the untrue version is the one that gets written
under time pressure. This is the same shape as a gate with no recorded way
around it — see the last part of *How much gate is enough* — with the same
remedy: a route that records what happened beats a rule that forbids it.

**`ready:` is the mechanism for the waiting half.** A phase that needs an
answer from outside can probe for its arrival — `ready:` answers `PENDING`
until the file is there, spending no attempt and running no gate — and then
gate on the artifact once it exists. That splits waiting from consuming, which
is the split the failure above is missing. Keep the two in separate phases: one
whose job is that the answer has landed, one whose job is what the answer
changes. Then "who decided this" is a fact the artifact carries into the
record, rather than something the phase's instructions have to imply.

## How much gate is enough

The questions this section answers are quantitative — how many phases, how many
checks in one gate, whether a check that always passes is worth keeping — and
they have better answers than taste. Phase-gate methods have been written about
for decades, and two of the answers below are borrowed rather than invented.
Where a claim is this project's reading of borrowed material rather than the
material itself, it says so.

**Before adding a check, answer two questions.** Is its passing a claim no
other check in this gate makes? And when it goes red, does that call for a
different next move than the other checks' red does? Two unrelated fields
converge on this. Certification guidance for airborne software will let a tool
take over a verification activity, and requires the tool itself to be shown
trustworthy only when its output is *the only* evidence for the claim — the
question is what a signal is the sole evidence of, not how many signals there
are. Alarm-design guidance for chemical plants says each alarm must have a
defined operator response, and that a condition which is true all the time must
not be an alarm at all. Read together, the cost of another check is not the
minute it takes to write: it is paid when one red no longer tells you what to
do next. Checks whose red leads to the same move can be one check.

**Phase count follows the risk of the work, not a number.** The rule the
literature offers is that heavier work gets more stages, and that one shape
should not be used for every job — supported by an observation worth having:
where an organisation ran everything through its full multi-stage process, the
small jobs went around it, and those small jobs turned out to consume most of
the development effort. The remedy was not fewer stages but *several versions*,
with a single gate at the entrance deciding which version a job goes through.
Applied here: if this repository's work is one kind, size the phases to that
kind; if it is several, that is what having several workflow files, or a router
phase at the entrance, is for. Whether seven phases is too many is not settled
by seven. It is settled by whether those seven look at seven different things —
adjacent phases watching the same thing can be one phase.

**A check that always passes: ask whether it is the only evidence.** If it is
the sole check making its claim, dropping it takes the claim's evidence to
zero. If another check confirms the same thing independently, dropping it costs
nothing. And keeping it is not sufficient either, which is the part worth
sitting with: a check broken into permanent success and a check passing
honestly emit the same green. Automation ergonomics has said since 1983 that
you cannot confirm a rarely-changing signal's health by watching it — the
question in that literature is who notices that the alarm system itself has
stopped working. Measurement agrees from another direction: large-scale
mutation analysis at Google found that code with satisfactory statement
coverage still had significant numbers of places where lines ran but results
were never checked. So an always-green check you have never seen go red buys
about as much regression detection as deleting it would. If you keep one,
deliberately break the thing it watches once and confirm the red.

That last move has a name in the testing literature, which is worth knowing
because it means the failure is a known type rather than your oversight: a
test that passes whether or not the code is broken is a **rotten green test**,
and the method it covers without ever exercising an assertion is
**pseudo-tested**. The detection procedure in that work is exactly the one
above — change the thing under it and see whether it goes red. Note where this
lands relative to the three positions: **it is a different axis from what a
check reads.** An unfakeable check can be rotten green too. Sorting a gate into
unfakeable/anchored/fakeable says what a check would prove if it failed, and
says nothing about whether it can fail.

**You cannot close the way around a gate; you can make it expensive and
recorded.** This is the part that changes most when the gatekeeper is a shell,
and it is this project's reading rather than a borrowed claim. Human-run gates
carry a legitimate "does not meet it, proceeds anyway" path: one large
engineering process writes it into the entry criteria themselves — all
technical requirements met *or a waiver exists* — and its reviews complete not
when every issue is gone but when the open ones have an agreed plan and a named
decision-maker signs. An exit code has no value for that state. So work that
lands in it either stops, or takes a route nobody records: the check gets
commented out, rewritten to always succeed, or pointed somewhere harmless.
Since the file can always be edited, forbidding the decision achieves nothing.
Prefer arrangements where relaxing a gate leaves a trace in the run — a phase
that has to write down what was accepted, rather than a check that quietly
stops being run. The same shape turns up in a phase's *instructions* rather
than its gate, where a rule that forbids a legitimate case sends the work into
a record that is not true; *Work that arrives from outside the run*, above, is
that version of it.

## A round that has nothing for a phase

A phase is written for the round that has work for it. Then a round arrives
where the phase's subject is missing: nothing was implemented, so there is
nothing to screenshot; no document moved, so there is nothing to review. The
gate runs anyway, and asks for the artifact anyway.

**Settle what a round is before you reach for a deletion, because a round is
not always a run.** A workflow whose last phase routes back to its first holds
many rounds inside one run: `start` empties `.headsign/tmp/` once for all of
them, and a file written there in one round is still sitting there in the next.
In that shape the run-scoped deletion proves nothing about a round, and the
round-scoped one is the phase's `clear:`. A looping workflow that wants an
artifact dated to the round therefore reaches for `clear:` or for git, and the
`tmp/` wipe answers a question it is not being asked.

**What that round produces is a green gate over an earlier round's artifact.**
Whoever is driving finds the directory the last round left, points the check at
it, and the run advances. The log then records the phase as passed, so the
run's history says the round showed something it never made, and a later reader
of that history has nothing to tell the two apart with. This is the gate-shaped
case of the rule at the end of *How much gate is enough*: a legitimate case
with no route of its own takes the route nobody records.

**Give the empty round an edge of its own, and let a command decide which round
it is.** A list-form `on_pass` on the phase before the one that can be empty
carries it past:

```yaml
  try:
    # ... description and gate ...
    on_pass:
      # A round that changed no source has nothing to show, and says so here,
      # where git decides it — rather than in the show gate, which would have
      # to accept an old directory to let this round through.
      - when: 'git diff --quiet "$(cat .headsign/tmp/base)" -- src/'
        to: verdict
      - to: show
```

The `when:` reads git, so which edge the round takes stays out of the round's
hands. An `ADVANCE` reached this way prints the route it took and writes the
same line into `.headsign/log`, so a phase skipped this way leaves a record
naming the condition that skipped it.

The base commit is the entry phase's mark under `tmp/`, and it carries the same
requirement every anchor carries: a check that the file names a real commit,
placed where the gate runs it before anything measures against it. Comparing
against `HEAD` instead reads only what is uncommitted, so a round that
committed its work looks empty to it.

**Where no command can tell the two rounds apart, have the round declare which
one it is in.** The phase writes what it reused, and why, to a file the gate
reads, and the gate passes on a fresh artifact or on that declaration. A check
on a declaration is fakeable, and that is the trade you are making: a fakeable
check that leaves the exception in the record beats an anchored check that the
round walks around in silence. Say which of the two the gate is when you hand
the workflow over.
