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
