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
