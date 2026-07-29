# ADR-0023: Pinning the graph a run is walking under

- Status: accepted
- Date: 2026-07-30
- Amends: [ADR-0016](0016-explainability-as-the-fitness-function.md) §5 (its
  rule for a run that rewrites its own workflow is now machine-checked rather
  than only written down) and
  [ADR-0017](0017-three-budgets-and-the-recoverable-ceiling.md) (raising the
  ceiling mid-run is now recorded, and there is a second ESCALATE that ends
  nothing)

## Context

`headsign next` re-reads the workflow file on every lap, and that is a
deliberate property, not an oversight. ADR-0017's recoverable ceiling depends on
it — a person raises `limits.max_total_iterations` in the file and the run
continues — and ADR-0016 §5 goes further, permitting a run to rewrite its own
workflow, with the rule *protect only the phases you have not entered yet*.

Two of the possible mid-run edits are already loud. If the phase the run is
standing on disappears, `next` refuses (exit 3). If a routing target
disappears, the file no longer validates and `next` refuses on the load. What is
silent is everything else, and one case in particular: a run can fail a phase's
gate three times, have that gate loosened underneath it, and pass — with
`attempts` carried across from the stricter rules, and no record anywhere that
the rules changed. `.headsign/notes/what-headsign-protects.md` #4 names that
shape exactly: a place where what someone believes and what the machine did
drift apart in silence, and the instruction there is *make it loud or make it
impossible*.

There is a second, sharper way to say why it matters. Editing the workflow
mid-run is a **sanctioned** act — two ADRs recommend it. Editing `state.json` is
sanctioned nowhere and mentioned in no instruction an agent reads. So today,
loosening a gate and doing what the documentation recommends are the same edit,
and nothing can tell them apart. That is the deniable path, and it is the thing
worth closing.

## Decision

**1. A run pins the rules it is walking under.** `state.json` gains
`graph_fingerprint` — a hash per phase reachable from where the run stands, plus
one `$limits` entry — taken at `start` and compared on every lap.

**2. What is pinned is everything but `description`.** An exclusion list, not
an inclusion list: a field added to the schema later is pinned by default rather
than forgotten, the same instinct as ADR-0015's refusal to walk past an unknown
key. `description` is out because ADR-0003 makes it advisory and ADR-0016 §5
depends on being able to rewrite it mid-run. `clear:` is therefore in, which
matters: dropping a `clear:` is how a stale `APPROVED` verdict passes a review
gate, so it is a rule, not an instruction.

The hash is of the parsed structure with keys sorted, not of the file's bytes.
Comments, indentation and quoting are not rules. Array order is preserved,
because a gate's checks run in order and a k-way `on_pass` resolves in order.

**3. The comparison is scoped to what the run can still reach.** ADR-0016 §5's
rule, made mechanical: a phase the run has walked past and cannot return to can
be rewritten freely, and reporting such an edit would make the ordinary case
noisy enough to train everyone to ignore the report. Only keys present on both
sides count — a key that appears (the reachable set widened) has never been
depended on, and a key that disappears (the run moved past it) no longer is.

**4. The check runs before anything reads a rule.** After the phase-missing
guard, before the ceiling, the `ready:` probe, the gate and `step()` — every one
of which reads the definitions being checked. Check the graph before using the
graph. Where in a lap this sits is a routing rule, so it lives in `engine.ts`
(ADR-0018).

**5. A difference is reported once, as an ESCALATE that ends nothing**, and
**the reporting lap writes only the marker** — not the fingerprint, not the
counters, not the phase. That is what makes restoring the file free and silent:
put it back, and the next lap matches the pin again, clears the marker, and says
nothing. Update the fingerprint at report time instead and the correction
becomes a second difference, escalating again and counting the fix as a change —
the most correct response would cost the most. The marker holds the *digest* of
the reported map rather than a flag, so a second edit made after a report is
reported too instead of riding through on the first one's acceptance.

**6. Asking again is how a change is accepted**, and acceptance is counted.
There is no separate approval command, and there should not be: an agent has the
same shell a person does, so no act headsign can demand is one only a human can
perform. A ceremony that pretends otherwise would be claiming what it cannot
prove (protects #3).

**7. A change to `limits` alone is never reported.** It is accepted on the
spot, counted, and the lap carries on — so the ceiling and the raise that
answers it stay one stop, as ADR-0017 designed. The reason is not convenience:
the ceiling's own ESCALATE *was* the human beat. A person read the wall and
decided the run deserved more room; asking them to confirm the decision they had
just made would teach everyone that the report is noise. Raising a ceiling also
cannot loosen a judgment — it makes a run longer, and that fact is exactly what
the count at COMPLETE exposes.

**8. The count is reported where somebody will see it.** `.headsign/log` is
gitignored and never reaches a pull request, so `COMPLETE` gains a line naming
how many changes the run accepted — and only when that count is above zero, so a
run that changed nothing prints what it always printed, to the byte. `status`
gains the same line, plus one for a difference reported and not yet accepted.

**9. No opt-in flag in the workflow file.** The obvious alternative — a key
declaring whether this workflow may be modified mid-run, pinned at `start` — was
considered and rejected below.

## Alternatives considered

**An opt-in `self_modifiable:` key, respected as of `start`.** The idea that
began this design. Rejected for three reasons. It would be a flag in the very
file it governs, so its authority is self-referential; pinning it at `start`
answers that, but an agent can still `abort` and `start` again, and `start`
truncates the log. It cannot distinguish a human's edit from an agent's, so
"self-modification allowed" would be a misnomer for "this run tolerates its
graph changing". And a default of *not* modifiable collides with ADR-0017 unless
`limits` is carved out, at which point the flag is doing less work than the
carve-out. What survived from it is §7's carve-out and the two-beat report.

**Refuse (exit 3) until the file is restored, with no accept path.** Strictly
stronger, and it was tempting. Rejected: the most common mid-run edit to a gate
is not an attack but a typo — a wrong path, a wrong flag, a check that cannot
pass as written — and this would send exactly that case to abort-and-restart,
which is the one case where the author is least at fault. It also would not stop
the actor it was aimed at, who can edit `state.json` or restart the run.

**Accept once, then freeze the graph for the rest of the run.** A one-way door,
so a gate cannot be loosened repeatedly one escalation at a time. Rejected on
the same evidence: it rescues the first typo and walls off the second, and the
person paying is the one authoring a workflow, while the actor it aims at
restarts the run.

**Freeze the graph for the run (an immutable plan version).** The
scheduler-theoretic account of agent execution in
[arXiv:2604.11378](https://arxiv.org/abs/2604.11378) makes this a principle —
*execution plans are immutable within a plan version* — so an edit yields a new
version instead of changing the running one. Rejected for the reason the two
entries above already give: here the sanctioned recovery *is* an edit to the
file the run is walking under (ADR-0017), and telling its author to start a new
version is telling them to abort and start over.

**Report every change, `limits` included.** One rule, no carve-out. Rejected
under §7: it makes ADR-0017's documented recovery stop twice, and the friction
falls entirely on the person who is behaving correctly.

**Keep a list of every fingerprint the run has seen** rather than a count.
Rejected: a hash is unreadable and the content behind it is unrecoverable, so a
list tells a later reader nothing they can act on. What is *not* recoverable
elsewhere is which phases changed — an uncommitted edit leaves no other
trace — so the map is keyed by phase name and the log line names the keys that
moved. The file's history belongs to git.

## Consequences

- **`ESCALATE` now has two reasons that end nothing** (this one and the
  ceiling), where ADR-0017 could say "two of the three ways to reach ESCALATE
  end it; the ceiling does not". `plugin/skills/workflow/SKILL.md` named the
  ceiling by its reason string, so it needed the correction more than the
  reference page did.
- **A run's final answer can now carry a fact about the run's own honesty.** A
  run that reached `COMPLETE` having loosened its rules no longer looks
  identical to one that did not.
- **This is a guardrail, not a lock, and the record says so.** An agent that can
  edit the workflow can edit `state.json`; nothing here changes that. What it
  removes is the deniable path.
- Three fields join `driver_agent` in being tolerated when absent, for runs that
  started before they existed. The criterion for removing that tolerance is
  written at the declaration, next to `driver_agent`'s, and not restated
  anywhere else (protects #8).
- The fingerprint is computed in `workflow.ts` because it is a fact about the
  schema and the reachability walk; the run record holds it, `engine.ts` owns
  the four-branch rule, and `render.ts` owns every word said about it. The
  existing module map absorbed the feature without a new seam.
