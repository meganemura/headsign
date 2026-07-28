# Decisions

## Must one fitness run cover every function in src/, or may a run cover a single module?

**Decision: a run may cover a single module, and that is a real fitness run —
not a rehearsal for a whole-repo one.**

Reason: ADR-0016 says what this fitness function is for, and it is not
certification. Decision 1 puts the value in the address — "not 'the codebase
is fat' but 'this function is too complicated', by name". A one-module run
produces that finding with exactly the same force as a whole-repo run, and
produces it seven times sooner, which is what a detector is for.

The arithmetic backs the same answer. `src/` holds 76-89 functions depending
on whether inline arrows count, and `inventory` explicitly asks for them, so
take 89: a whole-repo sweep costs 271 laps before a single rejection, against
a ceiling of 300. That leaves fourteen rejections for eighty-nine functions.
The largest single module, `cli.ts`, costs 73 laps clean and 165 in the worst
case where every function burns all three tries — both comfortably inside the
same ceiling.

What this answer costs, stated plainly: no accumulation of per-module runs
ever supports the claim "src/ passes". The strongest honest claim is "each
module passed when it was swept", because the sweeps happen at different times
against different revisions. Making it stronger would mean invalidating a
module's entry when its file changes, which is a tree-hash by another name,
and ADR-0012 removed one of those for hiding non-progress.

Follow-on work this creates:

- `inventory`'s description says "List every function in `src/*.ts`". The gate
  never checks that — it only asks whether the queue has a line on it — but
  the description is what the agent reads, so it has to say that a run may be
  scoped to one module.
- ADR-0016 Decision 1 describes the sweep as covering `src/*.ts`. It needs a
  note that the swept set is a parameter of the run and that `report`
  certifies the swept set, nothing wider.

## Should the explainability ledger live somewhere that survives the next `headsign start`, rather than under .headsign/tmp/?

**Decision: the ledger stays in `tmp/`; the sweep's two outputs get durable
paths with gates on them.**

Reason: sorting the nine files the sweep writes by what each is for dissolves
the question. Six (`queue`, `current`, `tries`, `explain.md`, `verdict`,
`done`) are the sweep talking to itself, and `done` in particular would be
harmful kept — a list of "these were explainable" carries no date and reads as
a present-tense property of code that has since moved on. What has to survive
is the finding (`unexplained` and the `summary.md` built from it) and the
lessons (`lessons.md`, which is supposed to become
`.headsign/notes/explaining-well.md`).

Both of those are carried today by a sentence in a `description` and by no
check at all. `report`'s gate proves `summary.md` is non-empty and that
nothing went unexplained; it never looks at whether the copy-somewhere-durable
happened. `improve`'s gate is two `grep`s against `.headsign/fitness.yaml`
proving this run can still reach its end; it never looks at `.headsign/notes/`.
ADR-0003 settles what that means: a description choreographs, only the gate
enforces.

What is at stake is not notice but persistence. A sweep that finds something
escalates out of `report` and lands in a person's hands, so the finding is
never silent. It is the *clean* sweep that ends quietly, reaching `$end` with
its summary and its lessons in a directory the next `headsign start` deletes
with `fs.rmSync`.

Follow-on work this creates:

- `report` writes `.headsign/notes/last-sweep.md` — fixed path, tracked in
  git, naming the swept set (the previous decision made that set a parameter
  of the run) — and gains a third check proving it is there.
- `improve` gains a check that `.headsign/notes/` actually changed, so folding
  the lessons in stops being optional.
- Accepted cost: a clean sweep now produces a commit for a file that says
  nothing was unexplained, and only the latest summary is on disk, with older
  ones reachable through git rather than by listing a directory.

## Should the per-function retry cap stay at 3 explain attempts before the function is recorded as failed?

**Decision: yes, keep 3 — and the two defects the question was hiding are
worth more than the number.**

Reason: the cap is where the workflow separates "the explanation was bad" from
"the function is bad". One unaided draft plus two informed rewrites makes a
rejection say "two informed rewrites failed, and the second had the first's
note to work from", which is a sentence that would make someone open the
function. At 2 it says only that the first informed rewrite failed. At 4 the
extra attempt is handed the same context as the second. Once a run covers one
module (first decision on this list), the lap-cost differences are not near
anything that binds.

Two findings from the challenge, both of which outrank the cap:

1. **The try counter is not enforced.** `explain`'s check is
   `test -s .headsign/tmp/tries` — non-empty, not incremented. It bites on the
   first attempt only, because `record` cleared the file; from attempt 2 an
   agent that forgets to append passes with a stale count and the `-ge 3`
   route never fires. The workflow's own comment says the counter is "checked,
   not trusted"; it is trusted. A stuck function then bounces between
   `explain` and `judge` until `max_total_iterations` ends the run on the
   spot, with `learn`, `improve` and `report` unreached. This is a gate defect
   and should be fixed — check that the count went up, or have `explain` write
   a line the check can require by name.

2. **Attempt history survives only in the driving agent's context.** `judge`
   clears `verdict` on entry, so only the latest note is ever on disk. The
   agent remembers the earlier ones, which is enough until the context is
   compacted — and headsign's own skill treats mid-run compaction as routine.
   After a compaction, the strongest evidence a sweep can produce — the same
   clause defeating three different rewrites — exists nowhere. This is a
   structural change, which `improve` may not apply on its own, so it goes to
   a person as a proposal.

Arithmetic correction worth keeping: an exhausted function costs 7 laps
against 3, so **+4** each. Ten of them on an 89-function whole-repo sweep is
311 against a 300 ceiling — the cap and the ceiling are coupled at that scale,
and are decoupled only because runs may be scoped to one module.

## Should .headsign/fitness.yaml raise max_total_iterations above its current 300?

**Decision: no. Keep 300, and fix what it is a ceiling for.**

Reason: the ceiling is load-bearing and must stay — the explain↔judge bounce
is the workflow's known failure mode, and no `max_attempts` can catch it,
because `judge`'s gate *passes* every lap and the rejection is taken on the
pass path where the phase's attempt count is deleted. The global limit is the
only thing in the system that can stop it.

300 was not arbitrary: the comment set it against "roughly seventy functions",
which is 214 laps clean with 86 to spare. The number did not move, the count
did — 76 without inline arrows, 89 with them, and `inventory` explicitly asks
for them. At 89 a clean sweep is 271 and the margin is fourteen rejections
across eighty-nine functions. That is an ordinary sweep going through the
wall, and it goes through destructively: the limit check sits ahead of the
ready probe and the gate, so `learn`, `improve` and `report` never run.

Read the module row instead and it inverts. The largest module, `cli.ts`, is
73 laps clean and 165 with all 23 functions burning every attempt — and 300 is
nearly twice that. (Both figures assume no gate failures; those are extra laps
on top.)

So the fix is scope, not arithmetic. Follow-on work:

- `inventory`'s instruction says a run covers one module, rather than "every
  function in `src/*.ts`". The first decision on this list made a module run
  *legitimate*; this one makes it the instructed scope. Whole-repo coverage is
  seven runs — `src/` is seven modules.
- The comment under `limits:` inverts: instead of explaining how to narrow the
  scope, it states the scope the number assumes and says that widening it
  means raising the number — a whole-repo sweep needs an estimated 700, and
  running one at 300 does not fail safely.

Accepted cost, stated honestly: a whole-repo run becomes something you opt
into by editing two things. That is the cheapest fix available, not the right
shape of a control — the editor gets no warning about which edit matters, and
friction is not the same as expressing that a decision is big. And it does not
touch the underlying problem, that the ceiling ends a run by discarding its
learning phases. It only puts the ceiling out of reach.

## Should the sweep route itself out to `learn` while budget remains, instead of running until max_total_iterations ends the run?

**Decision: no budget route. Add the check the proposal exposed instead —
`report` must prove the queue was actually emptied.**

Reason: the route cannot be written honestly. Nothing in `.headsign/tmp/`
holds the lap count, and no supported command exposes it — `headsign status`
prints phase, attempt, workflow and driver, and no count; the number appears
only in `.headsign/log` as `i=` and in `state.json`, whose shape
`docs/architecture.md` assigns to `src/state.ts`. A `when:` scraping either is
depending on a format nobody promised to keep, and it fails *silently*: the
grep finds nothing, `test` sees an empty string, the route does not fire, and
the sweep runs into the ceiling exactly as before. It would also write the
limit in two places, which `.headsign/notes/what-headsign-protects.md`
forbids, and there is no way to reference `limits.max_total_iterations` from a
`when:` because ADR-0003 refuses expression languages.

The decisive objection is what the route would do when it fired. It leaves for
`learn` with functions still queued; those were never claimed, so nothing was
filed against them in `unexplained`; `report`'s two checks both pass and the
run reports COMPLETE on a sweep that skipped part of `src/`. That is a worse
failure than the loud one it was meant to replace.

Which uncovered the real hole, and it has nothing to do with budget: **`report`
certifies a sweep it never confirms happened.** `record`'s gate asks only that
the claimed line left the queue, so an agent that removes one line too many
takes the normal edge to `learn` and lands in a `report` that declares the
sweep clean.

Follow-on work:

- `report` gains a check that `.headsign/tmp/queue` is present and has no
  non-blank line left on it. Every abnormal ending then arrives at `report`,
  writes its summary with `learn` and `improve` already done, and escalates
  instead of certifying.

Practical note worth carrying: `grep -v ... > new && mv new old` exits 1 when
it outputs nothing, so on the *last* item the `&&` short-circuits and the list
keeps the line it was meant to lose. Both workflows catch that one with their
"the claimed line left the list" check. Nothing catches the opposite mistake,
which is what the new check is for.

## Should headsign let a workflow name a phase to enter when limits.max_total_iterations is reached, instead of always escalating on the spot?

**Decision (answered by a person): no new field and no finally. Instead, the
ceiling's escalation stops being terminal — `checkIterationLimit` reports
ESCALATE without writing `status: "escalated"`, so the run stays RUNNING and a
person who raises the limit can continue it with `headsign next`.**

The reasoning was reshaped by one question from the person being asked:
*is running out of the three explain tries an abnormal ending?* It is not, and
seeing why broke the category this question was framed in. Three budgets were
being lumped together:

- `tries` counts **successful laps** — the judge answered, it just said
  REJECTED. Running out is a result, routed to a declared destination on the
  pass path (ADR-0011). Nothing is exhausted from headsign's point of view.
- `max_attempts` counts **gate failures**. Running out means the agent cannot
  satisfy the phase's checks — genuinely stuck, and ADR-0014 is right that
  this is the canonical moment to ask a person and end.
- `max_total_iterations` counts **all laps**, a mixture of the two.

So of the three endings, only the global ceiling can fire on a run that is
doing nothing wrong. The "two doors, therefore a finally" argument that most
of the analysis rested on was wrong: there is one door.

That also removes the cost this option was thought to carry. Making one
producer of ESCALATE recoverable is not a dent in ADR-0002's contract but a
line with a reason behind it: the two escalations that mean *something is
wrong* stay terminal, and the one that means *this run was bigger than
declared* can be answered. The message, the exit code and the runaway
protection are unchanged — the check still runs ahead of the gate, so repeated
`next` calls reprint the wall and spend no laps.

Follow-on work:

- `engine.ts`: `checkIterationLimit` returns the ESCALATE outcome without the
  terminal status write. Tests for both halves: the wall reprints and costs no
  laps; raising the limit and running `next` resumes the same phase.
- `docs/adr/0002`: the transition table's `max_total_iterations` row, plus the
  idempotent-on-terminal-states paragraph, which now has an exception.
- A new ADR recording the three-budget distinction, since it is the reason the
  exception is principled rather than arbitrary.
- Rejected and worth recording as rejected: `limits.on_exhausted: <phase>`
  (revives a name ADR-0014 removed one day earlier, needs one-shot state to
  stop it looping) and a general finally block (a phase entered without a gate
  having sent anyone there, which headsign has never done).
- Still worth doing on its own merits, no longer needed as a workaround:
  `record` appending its finding to the durable file as it is produced.

## Should the first real fitness run be a pilot over one module before any full sweep?

**Decision: yes — run a pilot on `src/gate.ts` first, and apply none of the
six `fitness.yaml` fixes beforehand.**

Reason: two earlier decisions already made every run a one-module run, so what
was left of this question is order — fix first, or run first. Six changes are
queued against a file that has been validated and never executed. The log
cannot prove that (it is run-scoped and truncated at every `start`), but
`.headsign/notes/explaining-well.md` still opens "First edition" and carries
none of the worked examples its own last section says `improve` must add, so
no sweep has reached `improve`.

The assumptions that only a run can test are stacked in `judge`: whether a
subagent really writes the verdict file itself rather than reporting back
(ADR-0007's middle rung depends on behaviour, not YAML), whether
`grep -qx -e APPROVED -e REJECTED` matches what a judge actually writes,
whether the `ready:` probes produce free PENDINGs in the order an agent really
works, whether the rejection edge routes and `tries` reaches 3 in a real loop.
And whether a judge forbidden from opening `src/` is useful at all.

`gate.ts` because it is the smallest module under either counting rule — four
named functions, four with inline arrows included, where `engine.ts` goes from
four to eight — so it does not inherit the counting ambiguity that ran through
this list. 16 laps clean. Its functions carry real edge behaviour (spawn
failure, timeout, a nonzero exit meaning "not this branch"), which is what the
judge's fixed question asks about.

Correction worth keeping: running first does **not** let the workflow fix
itself. `improve` may not apply "a new phase, a different graph, a gate that
would need discussion", and five of the six fixes are exactly that. What
`improve` can do is grow `explaining-well.md` from the approved and rejected
explanations.

Accepted risks: the pilot runs with the unenforced try counter, a `report`
that does not verify the queue, and no durable output. The last two are
readable and copyable by hand at four functions. The first is not mitigated by
care — the agent that must remember to append is the one that must remember to
watch — but a bounce is obvious within a few laps at this size, and the
approved ceiling change means the wall it would reach is no longer fatal.

Ordering: the headsign ceiling change lands *after* this grilling run
finishes. This session drives `design-grilling` through the bundle in the
plugin cache, and rebuilding swaps that CLI underneath a live run.
