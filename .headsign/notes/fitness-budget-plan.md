# What was agreed about the fitness run's iteration budget

Produced by `.headsign/grilling.yaml` (`design-grilling`), 2026-07-28, seven
questions, 21 laps. Six answers came out of the explaining; one went to a
person, and came back as a question rather than a choice.

## The seven answers

**1. Must one fitness run cover every function in `src/`?** No. A run may
cover a single module, and that is a real fitness run rather than a rehearsal.
ADR-0016 puts the value in the address — "this function is too complicated",
by name — and a one-module run produces that with the same force, seven times
sooner. What it gives up: no accumulation of per-module runs supports "src/
passes", only "each module passed when it was swept".

**2. Should the ledger survive the next `headsign start`?** The ledger stays
in `tmp/`; the two *outputs* get durable paths with gates on them. Six of the
nine files are the sweep talking to itself, and `done` would be actively
misleading kept. The finding and the lessons are what must survive, and both
are carried today by a sentence in a `description` and no check at all.

**3. Should the per-function retry cap stay at 3?** Yes. One unaided draft
plus two informed rewrites makes a rejection say something worth acting on.
Two findings outranked the number: the try counter is not actually enforced
(`test -s` cannot tell a fresh attempt from a stale file), and attempt history
survives only in the driving agent's context, so it is lost at compaction.

**4. Raise `max_total_iterations` above 300?** No. 300 was set against a
~70-function count and is right for a module-scoped run (the largest module is
73 laps clean, 165 worst case). Fix the scope, not the number: `inventory`
says one module per run, and the comment under `limits:` states the scope the
number assumes.

**5. Route out to `learn` before the budget runs out?** No. No supported
interface exposes the lap count — `status` does not print it, and scraping
`state.json` or the log's `i=` depends on formats nobody promised to keep, and
fails silently when they change. Worse, the route would leave `unexplained`
empty and `report` would certify a partial sweep as COMPLETE. That exposed the
real hole: **`report` certifies a sweep it never confirms happened**, and the
mistake that gets you there — removing one line too many from the queue — is
ordinary.

**6. Should headsign gain a phase to enter when the ceiling is reached?**
*(Answered by a person.)* No new field, no finally block. Instead the
ceiling's escalation stops being terminal: report ESCALATE without writing
`status: "escalated"`, so a person who decides the run was merely large can
raise the limit and continue with `headsign next`.

**7. Pilot first?** Yes — `src/gate.ts`, with none of the six `fitness.yaml`
fixes applied beforehand. Six edits to a workflow that has never executed a
lap is a worse position than sixteen laps of evidence.

## The order of work

1. **Finish this grilling run.** No rebuild until it ends — this session
   drives `design-grilling` through the bundle in the plugin cache, and
   rebuilding swaps that CLI underneath a live run.
2. **The headsign change — the ceiling stops being terminal.** `checkIterationLimit` returns
   ESCALATE without the terminal status write; tests for both halves (the wall
   reprints and costs no laps; raising the limit and running `next` resumes the
   same phase); ADR-0002's transition-table row and its
   idempotent-on-terminal-states paragraph, which now has an exception; a new
   ADR recording the three-budget distinction that makes the exception
   principled. Then rebuild and re-sync the plugin bundle.
3. **The pilot.** `headsign start fitness`, told at run time to
   queue only `src/gate.ts`. No file edit is needed for that: `inventory`'s
   gate never checks the queue's scope, and its `description` is advisory.
4. **Apply the six `fitness.yaml` fixes, informed by the pilot.**
   1. `inventory` says one module per run.
   2. The comment under `limits:` states the scope 300 assumes.
   3. `report` writes `.headsign/notes/last-sweep.md`, naming the swept set,
      gated.
   4. `improve` gains a check that `.headsign/notes/` actually changed.
   5. `report` gains a check that the queue was really emptied.
   6. `explain`'s try counter gets a check that can tell a fresh attempt from
      a stale file.
   7. Also worth doing on its own merits: `record` appends its finding to the
      durable file as it is produced, so no ending loses it.
5. **ADR-0016 gets a note** that the swept set is a parameter of the run and
   `report` certifies that set and nothing wider.
6. **The remaining six modules**, one run each.

## Deliberately not being done

- `limits.on_exhausted: <phase>` — revives a name ADR-0014 removed one day
  earlier, fixes one door, and needs one-shot state to stop it looping.
- A general finally block — a phase entered without a gate having sent anyone
  there, which headsign has never done.
- A `when:` route that reads the remaining lap budget — no interface to depend
  on, the limit written twice, and it fails silently.
- Raising `max_total_iterations`.
- Making `done` durable — a list of "these were explainable" carries no date
  and reads as a present-tense property of code that has moved on.
- Changing the 3-try cap.
- Any mechanism that turns accumulated per-module verdicts into "src/ passes".
- Fixing the lost attempt history at compaction. Recorded as a proposal
  (`improve` may not apply structural changes), not scheduled.

## Whether this loop earned its keep

Six of seven answers came out of writing the explanation, and each of those
six changed on contact with the `challenge` phase — not cosmetically. The
whole-repo lap arithmetic was wrong in the direction that flattered the answer
I was heading for. `improve`'s gate turned out not to enforce the thing I had
called already-enforced. The proposal to route out of the sweep before the budget ran out turned out to
convert a
loud failure into a false COMPLETE, which is what made the real hole visible.
None of those were found by reading the file; they were found by having to say
a claim plainly and then being made to ask why it was true.

The seventh is the more interesting data point. It went to a person, with four
candidates and a recommendation. The answer that came back was not a choice
among them. It was one question — *is running out of the three explain tries
an abnormal ending?* — and it dissolved the category the whole analysis rested
on. Three budgets had been lumped together: `tries` counts successful laps and
running out is a result; `max_attempts` counts gate failures and running out
means genuinely stuck; `max_total_iterations` counts both, and is the only one
of the three that can fire on a run doing nothing wrong. With that separation,
the "two doors, therefore a finally" argument collapsed to one door, and the
option I had ranked as costing a dent in ADR-0002's contract turned out to be
the principled one.

The lesson to carry into `explaining-well.md`: the phase did its job on six
questions, and on the seventh the naive question a person asked did more than
the phase did. That is an argument for putting the same move into the loop
more aggressively — `challenge` asks why a claim is true; it does not ask
whether the categories in the claim are the right ones.
