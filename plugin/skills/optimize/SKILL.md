---
name: optimize
license: MIT
description: Assess a finished headsign run for consequential improvements to its workflow, skills, checks, host integration, or headsign itself, then apply authorized local changes or record a concrete disposition.
---

# Optimize a headsign run

Use facts from the work. Diagnose the procedure that shaped the result. Prefer an improvement that can materially change a later outcome over a convenient small edit.

Reuse findings from an existing retrospective before doing more investigation.
For a larger change, identify the future capability or changed condition it
serves, the expected impact, and a concrete next step. Present that future as
a hypothesis; current demand measurements are not a prerequisite for a proposal.

During a run, keep observations outside `assessment.md`. A mid-run note does not settle the final assessment. Routine waiting is not an optimization event.

After `COMPLETE`, or after an `ESCALATE` that ends the run, inspect the result, repeated failures, confusing instructions, weak checks, and host behavior. Then do one of these:

- Retain a useful method and record why it should stay.
- Remove obsolete advice.
- Apply a bounded, authorized local improvement and verify it.
- Preserve a larger opportunity as an actionable proposal.
- Defer the assessment when an explicit user stop takes priority. A nonempty stop note also suppresses the terminal hook fallback.

Do not manufacture an edit. Do not spend the remaining task budget on low-impact polish when a larger opportunity matters more. Do not change requested outcomes, explicit budgets, access, unrelated work, publication, or external communication without the needed authority.

A reversible workflow change is allowed when the current task authorizes it and the required outcomes and constraints stay intact. Explain the change and its authority. During an active run, wait for headsign to report the graph change before you use `headsign next --accept-graph-change`. Do not use that flag to endorse a change after completion. If a check changed during a run, decide which earlier conclusions need verification. Do not replay side effects automatically.

Treat an earlier `COMPLETE` as historical. If an improvement changes the delivered artifact, verify that artifact again.

Use one assessment pass. Do not start an optimization run, expand your own budget, or optimize this record recursively. Report an escalation promptly. Do not delay the user's handoff.

Write the exact path that headsign supplied. Legacy and opt-out runs have no
assessment path; do not invent an identity or edit run state to create one.
If the user requests an assessment of such a run, report the findings through
the task's normal documents or response. For an enabled run, create the supplied
path's parent directory if needed. Keep the record a regular file of at most
64 KiB. LF and CRLF line endings are accepted. The first line must be exactly one of:

- `NO_CHANGE` — give a short reason.
- `APPLIED` — name the case, the consequential change, and its verification.
- `PROPOSED` — name the case, the opportunity, and a concrete next step.
- `DEFERRED` — name why assessment must wait.

Add nonempty text after the first line. Write the final record only after terminal completion or escalation. An explicit user stop can use `DEFERRED` earlier when that record can be written safely.
