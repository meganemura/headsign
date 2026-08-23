# ADR-0030: The token line is the contract, and nothing else is

- Status: accepted
- Date: 2026-08-23
- Amends [ADR-0002](0002-single-question-and-output-contract.md): its output
  contract said what is guaranteed. This says what is not, which the same
  section left to inference.

## Context

ADR-0002 settled that line 1 of `next` is a machine-readable token and
"everything after is instruction text", and it called that token line the
contract. It later recorded that `status` "never touches the token contract
above at all". Both are true, and between them they leave a reader to work out
by subtraction that `status`'s own output is unguaranteed.

Subtraction is a poor way to publish a promise, and the reader who most needs
the answer is the one least able to reach it: someone writing a tool against
this CLI. A downstream tool now exists. It reads `status` line by line —
correctly, because that is the public surface and `state.json` is not — and its
author asked what they may depend on.

The instruction from this project's author is plain: **headsign may change
anything outside the token line, at any time, and must not be slowed down by a
tool that reads it.** A support tool that constrains the thing it supports has
the relationship backwards. Keeping up is the reader's job.

Nothing here contradicts a decision. What it does is stop a silence from
reading as a guarantee.

## Decision

**1. The contract is `next`'s first-line token and the exit code beside it.**
`ADVANCE` / `RETRY` / `PENDING` / `COMPLETE` / `ESCALATE` / `ABORT`, and 0 / 1 /
2 / 3. `status`'s first line — `RUNNING` / `COMPLETE` / `ESCALATED` / `ABORTED`
— is a second contract of the same kind: one word, its own vocabulary, and the
exit-code rule ADR-0018 gave it.

**2. Everything else any command prints is not a contract.** The `workflow:`,
`driver:`, `last stop:`, `last moved:`, `observer:` and `graph:` lines, the
`--- last failure: ---` and `--- phase: ---` blocks, the wording inside them,
the order they appear in, and whether a conditional line appears at all. Any of
it may change in any release, patch releases included, with no deprecation
period and no migration note beyond the changelog.

**3. A tool that reads this output pins a version, and fails loudly.** Pin the
version you tested against, match strings exactly rather than by catch-all
pattern, and when a match fails, stop and say so. A reader that guesses at
unfamiliar output produces a confident wrong answer, which is worse than no
answer — the failure mode the `graph:` lines of ADR-0029 were added to prevent
in the first place.

**4. This is a statement about what is owed, not a taste for churn.** Output
still changes for reasons, changes are still written down, and the wording is
still worked on rather than thrown around. What changes is whose cost is
weighed when it moves: this project's, not a reader's.

## What is deliberately not being done

**A machine-readable output mode (`--json`, or similar).** It would be the
opposite of this decision rather than a companion to it: a structured output is
a contract, and a contract is exactly what is being declined. The reason to
decline it is not distaste for the format but the coupling — one consumer's
schema becomes every future change's obligation.

That refusal is available to revisit. What would justify it is not one reader
wanting it, but a job headsign should be doing that no other channel can do.
The two most likely readers today — a viewer drawing a run, and a script
branching on a verdict — are already served: the second by the token line and
the exit code, which are contracts, and the first by the arrangement in
decision 3.

## Consequences

`docs/workflow-reference.md` states the boundary where a tool author reads it,
beside the `status` output it applies to, rather than only here.

A downstream reader that pinned a version and matched exactly keeps working
until it is updated, and finds out at once when it stops matching. A reader
that did neither breaks silently, and this record is what it will be pointed
at.

Line-by-line stability of the wording is now nobody's obligation. That
includes the wordings this repository has spent care on: care is worth
spending, and none of it is a promise.
