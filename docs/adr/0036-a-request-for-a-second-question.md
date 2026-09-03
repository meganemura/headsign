# ADR-0036: A request for a second question, and the four answers it gets

- Status: accepted
- Date: 2026-09-04
- Collects, rather than amends:
  [ADR-0001](0001-thin-harness.md)'s non-goal on additional judging commands,
  [ADR-0029](0029-status-answers-for-the-file.md) §4,
  [ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md)'s
  refusal of a machine-readable mode, and
  [ADR-0033](0033-the-one-variable-headsign-sets.md) §4. Each of those stands
  as written; this record says what they have in common and where the next
  instance is decided.

## Context

ADR-0001 lists among its non-goals "additional *judging* commands (`gate`,
dry-run variants, …) — the question is `next`, singular. Wanting a second
question is a sign the design is drifting."

That line has been reached for five times in six weeks, by four different
projects using headsign, and the five requests are not one request. Each asked
for something reasonable, each was refused, and **the refusal was written down
five times in five different places** — two of them inside a private ticket
that only its reporter reads, two inside another ADR's list of things it is not
doing, one in a reply sent yesterday. The sixth request will arrive. The cost of
a rule kept in five places is that it gets re-argued from scratch instead of
cited, and re-arguing it is how a non-goal quietly stops holding.

What the five asked for, and what each turned out to rest on:

1. **A read-only evaluation that spends no attempt** (`next --dry-run`), asked
   for so a caller could see whether a gate would pass. The reporter's own
   material answered it: their gate had a check that *writes* the marker later
   checks compare against, and a side-effecting check has its side effects in a
   dry run too. A flag that is safe for some gates and not others teaches the
   habit of attaching it.
2. **A declaration that a check is pure** (`pure: true`), so the flag above
   could be safe. Refused because nothing can enforce it: a check declared pure
   and not pure fails *worse* than no flag at all — the dry run reports that it
   ran safely, and the side effect happened anyway.
3. **A read-only way to learn how many checks a gate holds**, asked for by a
   caller that had been cut off mid-gate. Refused as a second mouth: the gate's
   first progress line already answers it while running, and two answers to one
   question can disagree with nothing to decide which is right. The progress
   lines were added instead.
4. **A command that prints the graph a run pinned** (`headsign graph`).
   Refused in ADR-0029: it answers more than the question asked, and it puts a
   second rendering of the workflow on the public surface, which then has to
   stay true as the schema moves.
5. **`status` answering whether a phase's work has been done yet**, asked for
   by a driver deciding between continuing an inherited run and starting over.
   Refused because answering it means running something, and a `status` that
   runs something is no longer the command that is safe to call while
   diagnosing.

Two neighbours belong to the same family and were refused in their own records:
a machine-readable output mode (ADR-0030 — a structured output is a contract,
and the contract is what is being declined) and an environment variable
carrying the attempt count into a gate (ADR-0033 §4 — a gate that reads it has
stopped asking about the tree and started asking about the run).

## Decision

**1. The question stays singular, and this record is where the next request is
answered from.** Not by restating ADR-0001's non-goal, which says the rule and
not the reasoning, but by naming the four reasons the instances actually rested
on. A request matching one of them is answered by that reason, cited.

**2. The four answers.**

- **It asks the same question through a cheaper mouth.** Two mouths can
  disagree, and nothing in the design decides which is right. Answered by
  making the existing mouth say more — which is what the progress lines were,
  and what ADR-0029's one computed line was.
- **It asks headsign to act on a declaration it cannot check.** A declaration
  that may be false turns a gap into a wrong answer, and a wrong answer is
  worse than a missing one. This is the same shape as the fake-check the gate
  tiers are named after.
- **It asks a looking command to run something.** Looking is free, deciding
  costs — that division is what makes `status` safe to call at any moment,
  including from a session that is not driving the run. A line that needs a
  shell command belongs in `next`.
- **It asks a gate about the run rather than about the tree.** A check is a
  question about the state of the work. The moment it reads the run's own
  bookkeeping, its passing stops being a claim about the tree.

**3. What a probe costs, stated once, because that is what most of these
requests are trying to avoid.** A failing lap costs one attempt of that phase
and one iteration toward `limits.max_total_iterations`, and while the phase's
`on_fail` is the default `retry` it **deletes nothing**: `clear:` runs on entry,
a retry never leaves the phase, and the files that phase produced stay where
they are. Two cheaper probes already exist and neither needs anything built.
A check written as `run: "sh checks/thing.sh"` is a command a person can run at
a prompt, which is a dry run in every sense that matters — and it is the shape
worth writing for that reason. Where a check is pure, that is exact; where it is
not, the reason a dry run could not have been safe is the same reason.

**4. What would justify revisiting any of them.** ADR-0030's own standard,
applied to the family: not one reader wanting it, but a job headsign should be
doing that no other channel can do. A request that arrives with a job no
existing mouth can be made to answer is a different request from the five
above, and the four reasons do not dispose of it.

## What is deliberately not being done

**Forbidding any of the five by name, forever.** The refusals above are
answers to what was asked, on the material that was brought. A named ban would
outlive its reasoning, and the reasoning is the part that decides.

**Listing the requests still to come.** Four reasons cover the five that
arrived; a fifth reason invented for a request nobody has made yet would be a
guess dressed as a decision.

**Counting the requests.** How many times something has been asked for is not
an argument on either side — five refusals with reasons is not four-fifths of a
case for saying yes, and it is not a case for closing the question either.

## Consequences

The next request of this shape is answered by citing a reason rather than by
rebuilding one, and if none of the four fits, that itself is the signal that the
request is new.

Nothing in headsign changes. No command is added, none is removed, and no
existing refusal is reopened or hardened: the four records this one collects
each stand exactly as they were written.

One thing does get harder, and it is the point: a future refusal that does not
fit one of the four reasons cannot be waved through as "the usual answer". It
has to say what it rests on, here.
