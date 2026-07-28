# Proposals for the fitness sweep

Things the sweep cannot currently do, found by using it. Nothing here is
decided; `improve` is forbidden from applying structural changes, so this file
is where they wait for a person.

## 1. A judge cannot check the "what it does not do" half

**The problem.** The judge is given one file — the explanation — and told to
read nothing else. That is what makes it a fair stand-in for a reader meeting
the module for the first time, and it works for the "what it does" half: a
description that contradicts itself, or leaves a gap, shows up in the text.

The other half cannot be checked that way at all. "This module does not know
about X" is a claim about the code, and the judge has no access to the code.
It can only notice that the sentence is there.

**The case.** `cli.ts` was approved on its first attempt. Its explanation
opened with what it is for, then said:

> It never decides anything about the workflow itself. It does not work out
> where a run goes next, it does not know what the words in a workflow file
> are allowed to be, and it does not judge whether a phase's checks passed.

The first of those three is **false**. `cli.ts` owns the order in which one
lap asks its questions — the allowance before the gate, readiness before the
gate, exhaustion before the failure route — and ADR-0002 introduces its
transition table, ordering included, as "the whole routing rule set".

The judge could not have known. Nothing in the explanation contradicts it.

**Why it matters more than a single wrong sentence.** An earlier decision made
the exclusion list the thing that makes a single purpose credible: a purpose
can always be stretched to cover a mess, but a mess has nothing it obviously
must not do. If the exclusion list is the load-bearing half **and** the
unverifiable half, then a scattered module passes by writing a generous one.
That is the sweep's own criterion resting on the part of the explanation
nobody checks.

**Directions, none chosen.**

- A second judge, allowed to read the code, that checks *only* the exclusion
  claims and nothing else. Keeps the first judge's blindness intact and adds a
  narrow reader who can verify. Costs a second subagent per item.
- Require each exclusion to name where it is enforced — "does not read the
  clock: the timestamp is a parameter" — so the claim carries its own
  evidence and a reader can follow it. Costs nothing per run; catches only the
  exclusions somebody thinks to justify.
- Have `report` mark exclusions as unverified, so a passing sweep says which
  of its claims nobody checked. Cheapest, and buys honesty rather than
  detection.
- **Sweep the seams (proposal 4 below).** Written later, and it is the better
  answer to this one: it verifies exclusions without letting any judge see the
  code, by making the mismatch appear in the text the judge already reads.

## 2. The sweep's own working papers do not survive

`report` copies its summary somewhere durable, and `improve` folds lessons
into the notes. Everything else — every explanation the sweep produced, and
the judge's notes on the ones it rejected — lives in `.headsign/tmp/` and is
deleted by the next `headsign start`.

So the record of a sweep is its conclusions, never its evidence. The `cli.ts`
explanation above had to be quoted from memory of writing it, because the file
is gone.

Whether that matters depends on what the explanations are for. If they are
scaffolding, deleting them is right. If a good boundary explanation is worth
keeping — and three sweeps in, some of them read like the documentation the
project does not otherwise have — then the sweep is throwing away its most
reusable output.

## 3. The exported surface is not audited

A boundary explanation reports what a reader could not predict from the text.
It is not a walk over every exported name.

`engine.ts` passed with three sharp edges named by its judge, and a fourth
that nobody found until somebody went through the exported names one at a
time afterwards. All four were the same shape: a precondition satisfied in
another file and stated nowhere.

Possible: a check that every exported name appears somewhere in the
explanation. Mechanical, cheap, and it would have caught the fourth. It proves
only that the name was mentioned, not that it was described correctly — which
is the usual bargain in this workflow, and usually worth taking.


## 4. Sweep the seams, not only the files

**The observation that prompted it.** Every fault this sweep failed to find
was a property of a *pair* of modules, and the sweep's unit is one module:

- `engine.ts`'s four entry points each assumed something — the run is running,
  the workflow was validated — that only `cli.ts` guaranteed. Both modules
  were explained honestly. `engine.ts` even said outright that it trusts its
  caller. Nothing was wrong *inside* either one.
- `cli.ts`'s approved explanation said it "does not work out where a run goes
  next", which was false because of what it did relative to `engine.ts`.
- The seam itself — the order of a lap sitting in the file the map forbids to
  hold a routing rule — is not visible from either side alone.

**Why that is not a coincidence.** An earlier decision made the exclusion list
the half that makes a single purpose credible: a purpose stretches to cover a
mess, but a mess has nothing it obviously must not do. And **an exclusion is
almost always a statement about somebody else.** "Does not decide where the
run goes" means *engine.ts decides that*. "Does not read the clock" means
*the caller passes one in*. So the load-bearing half of every explanation is
the relational half — and a sweep whose unit is one file can never check it.

### The unit

A **value import edge**, written `caller.ts>callee.ts` — a third item shape
alongside `module.ts` and `module.ts:name`, told apart by the `>` exactly as
the colon tells the first two apart.

`src/` has **14** import edges today, of which **11** carry values; the other
three (`gate→workflow`, `render→engine`, `render→state`) import types only and
have no behavioural seam to describe. So 11 items, comparable to the 7 of a
module sweep.

### What the explanation must contain

Three parts, and the third is what makes this work:

1. **What the caller uses the callee for** — the questions it asks and what it
   does with the answers.
2. **What the callee assumes the caller has already done.** Every
   precondition, in plain words: "it assumes the run is still going", "it
   assumes the workflow was validated", "it assumes the lock is held".
3. **The callee's own declared contract, quoted verbatim** — its
   `// Responsibility:` header and its row in `docs/architecture.md`.

### Why a code-blind judge can now catch what it could not

This is the whole trick and it is worth stating on its own. The judge still
reads only the explanation. But part 2 and part 3 are now *in the same
document*, so a precondition that the callee never declares is a
**contradiction in the text**, not a fact about code the judge cannot see.

The judge is asked two questions:

- Is every assumption listed in part 2 covered by the contract quoted in
  part 3?
- Does anything in part 1 contradict what part 3 says the callee does not do?

### What can be checked mechanically

Two things, both cheap, and they close the obvious ways to game it:

- **The quotes are real.** `grep -qF` each quoted line against the callee's
  source. A writer cannot paraphrase the contract into agreement with itself.
- **The queue covers every value edge.** Derivable from the imports, the same
  way the descent's floor is derived from the code rather than trusted to the
  agent.

### What it would have caught today

Both of the misses, and by construction rather than by luck.

- The edge `cli.ts>engine.ts` would have had to say "engine assumes the run is
  still running" in part 2, and quote a contract in part 3 that says nothing
  of the kind. The mismatch is on the page.
- The same explanation would have had to describe, in part 1, that `cli.ts`
  asks the questions in a fixed order — against a quoted row saying `cli.ts`
  must not know routing rules.

### Costs, and one discomfort

- 11 items at three laps each, plus retries: comparable to a module sweep, and
  additional to it rather than instead of it.
- A third item shape means `inventory` gains a third job. That is the same
  discomfort recorded when it gained its second, with the same answer: the
  graph does not change, and each item's shape selects its own branch.
- It should run **after** the module sweep, not instead of it. A module whose
  own boundary cannot be stated has no contract worth quoting.

### Open question for a person

Whether the quoted contract should be the source header, the map row, or
both. Both is more work and catches the case where those two already disagree
with each other — which is exactly the case that went unnoticed for weeks in
`cli.ts`.

---

# After five sweeps: what to change, and why

Written 2026-07-29, after the function sweep of `gate.ts`, three module
sweeps covering all seven modules, and two seam sweeps covering all eleven
value edges. Items 1–4 above were written *during* that work; this section is
the view from the end of it. Nothing here is implemented.

## 5. The measured result, and what it says the sweep is

| | |
|---|---|
| Laps | ~130 |
| Judge calls | ~30, at 11–21k tokens each |
| Bugs found | **1** — the stop hooks writing the record without the lock |
| Contract declarations added | **17**, across six module headers |
| Design changes triggered | 1 — moving the lap out of `cli.ts` |
| Rules accumulated in `explaining-well.md` | 15, each with its case |

**The verdict contributed least. The writing contributed most.** Three pieces
of evidence, and they point the same way:

- The bug did not come from a verdict. It came from writing the sentence "it
  assumes nobody is holding the lock" and reading it back.
- The refactor did not come from a verdict either. `gate.ts` and `cli.ts` were
  both *approved*, and the misplaced seam surfaced while writing what a
  boundary explanation has to contain.
- Of roughly thirty judge calls, nearly every rejection said "you did not
  write that down". That is a good editor. It is not a measurement.

So the honest description is not a fitness function — which should be cheap,
repeatable, deterministic, and something you gate on. It is **a forced-writing
exercise with an adversarial reader**, and it has different economics: most of
the value lands on the first pass over a piece of code, and re-running mostly
re-confirms a contract that was already written.

That is not a reason to stop. It is the reason the four changes below are the
ones worth making.

## 6. The changes chosen

### D. Sweep the diff, not the tree

**What.** The queue is built from what a change touched — the modules edited,
and the seams whose either end moved — rather than from the whole of `src/`.

**Why.** Cost currently scales with the size of the project and not with the
size of the change. Eleven seams cost 65 laps whether one line moved or none.
The single-seam exemption added to the coverage check during the last run was
the first admission of this; D is the general form.

**Cost.** "What a change touched" has to be computed, and computed
conservatively — a missed edge is a silently smaller sweep, which is the one
failure this must not have. Same discipline as `value-edges.sh`: fail loudly
rather than under-report.

### F. Executable predictions, so the judge stops giving opinions

**What.** The judge writes three falsifiable predictions from the explanation
— "given an empty list of checks it answers pass", "a check with no label is
reported by its own command text" — and a runner executes them against the
code. The verdict is how many came true.

**Why.** Today the question is "could a caller be surprised", and the answer
is an opinion formed by a reader who cannot check anything. Predictions are
checkable. This is ADR-0007's ladder: the sweep's gate stops being soft
because the judgment stops being the LLM's last word.

**Cost.** A prediction has to be runnable, which means a shape for writing one
and a runner that executes it. That is the largest single piece of work in
this list, and it is the one that changes what the sweep *is*.

### A. A verdict ledger keyed by content hash

**What.** Each item's verdict is recorded with a hash of what was judged, and
a later sweep skips items whose hash is unchanged — reporting what it skipped.

**Why.** D needs it: "what a change touched" is only trustworthy if there is a
record of what the last sweep saw. It is also what keeps B honest, below.

**Not a repeat of ADR-0012.** That removed a tree-hash cache which
short-circuited a whole run and thereby hid a run that was making no progress.
This is per-item evidence, and skipping is reported rather than silent.

### B. Keep the explanations

**What.** The explanation is saved rather than deleted with `.headsign/tmp/`.

**Why.** It is the best documentation this project has produced and it has
been thrown away five times. It is also what F needs: a judge writing
predictions needs a description thick enough to predict from.

**Why not E — writing the header directly instead.** They are not two ways to
do one thing; they are answers to different questions. **A header is a
contract**: normative, terse, in the code. **An explanation is a description**:
long, exampled, thick enough to predict from. `cli.ts`'s boundary explanation
ran to a page; its header is five lines. Collapsing them either bloats the
header — already 27% of `gate.ts` and 24% of `state.ts` — or starves the
judge, which is fatal under F. And the seam sweep already uses them as two
things: the explanation *quotes* the contract, so that a mismatch is visible.
One document cannot quote itself.

**The weakness, and what answers it.** A third document is a third thing that
can drift — exactly what happened to `cli.ts`'s header, which claimed for
weeks that it must not know routing rules while holding the ordering. A
answers it: a saved explanation carries the hash of what it described, so
after a change it is marked stale rather than quietly wrong.

**What would change this to E.** If the saved explanations turn out never to
be read. That is an empirical question with no data yet, because they have
always been deleted. Save them, and if nothing reads them across the next few
sweeps, collapse to E.

## 7. Considered, not chosen

- **C — mechanical pre-checks** (every exported name appears in the header;
  a "must NOT know about" naming a module is verified against the imports).
  Cheap, deterministic, and it would have caught the fourth sharp edge in
  `engine.ts`. Not chosen only because it is subsumed by F, which checks
  something stronger. Worth revisiting if F proves too large.
- **G — invert the audience**: give a fresh agent only the contracts and see
  whether it can make a correct change. An end-to-end test of the
  documentation rather than of the prose. Rejected for now as a second
  expensive mechanism next to F; it measures the same property less directly.
- **H — drop the pass/fail verdict entirely**, keeping only the writing and
  the adversarial reading. Tempting, because the verdict's information content
  measured near zero. Rejected because it collides head-on with what headsign
  is: gates decide. If F works, the verdict stops being empty and this
  question goes away.
- **I — a budget on the contract rather than on the code.** The inverse of
  ADR-0001's retired line budget: `gate.ts` now spends 19 header lines on 69
  code lines, and a module needing that much contract may be two modules. Not
  chosen because one day's data is not enough to set a number, and a number
  nobody enforces is what ADR-0016 replaced. Recorded because the question is
  real and the measurement now exists to ask it again later.
