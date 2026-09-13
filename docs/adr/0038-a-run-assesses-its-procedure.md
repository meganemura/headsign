# ADR-0038: A run assesses its procedure at the boundary

- Status: accepted
- Date: 2026-09-13
- Design policy: [ADR-0039](0039-design-for-the-model-that-improves-the-method.md)
  governs future changes to this mechanism. This ADR defines its current contract.
- Amends [ADR-0001](0001-thin-harness.md),
  [ADR-0006](0006-stop-hook-backstop.md),
  [ADR-0023](0023-pinning-the-graph-a-run-is-walking-under.md),
  [ADR-0027](0027-recording-who-drove-a-run.md), and
  [ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md).

## Context

A run can deliver its requested result and reveal a better way to do later
work. Gate failures can expose a weak check or instruction. A clean completion
can expose obsolete steps or a larger opportunity. The old boundary ended the
run without giving the responsible agent a consistent place to assess this
evidence.

The CLI cannot decide whether an edit improves the procedure. It also cannot
infer authority from an edit, a disposition, or a hook event. The model must
make those judgments from the user's objective and constraints. The runtime
can provide facts, a bounded opportunity, and a durable record.

## Decision

### New runs enable assessment

Every successful new run gets a fresh optimization identity. The user can opt
out for that run with `headsign start --no-optimize`. State from an older
version has no identity and receives no retrospective prompt.

At the first repeated failure of the same gate, normal CLI output asks whether
the work is unfinished or the procedure needs repair. This prompt occurs once
per run. Repetition is evidence, not a verdict about the workflow.

At terminal `COMPLETE` and terminal `ESCALATE`, normal output names the bundled
`optimize` skill and the exact assessment path. It can repeat until the record
is valid. The notice changes no outcome, counter, first-line token, or exit
code. `ABORT` receives no optimization request.

### The record is run-specific and durable

One record lives at `.headsign/optimization/<id>/assessment.md`. The directory
is gitignored and survives later starts. The record is a regular file of at
most 64 KiB. CRLF and LF line endings have the same meaning. The first line is
exactly `NO_CHANGE`, `APPLIED`, `PROPOSED`, or `DEFERRED`. The remaining text
is nonempty. A valid record suppresses later terminal notices and the hook
fallback.

The record is a self-report. It does not prove that the agent found the best
opportunity, had authority, or made a useful change. Useful conclusions move
into workflow instructions, comments, checks, or normal project documents.
The raw assessment does not publish itself.

Completion remains historical. If assessment work later changes the delivered
artifact, the agent verifies that artifact again. The run does not reopen.

### The hook offers one bounded continuation

Stop requests use positive attribution. A main-session Stop must match the
recorded command session. A SubagentStop must match the recorded delegated
agent. These identifiers remain distinct. Unknown identity passes, and the CLI
notice remains the guidance.

Across both hook events, one run can request at most one extra continuation.
Under the run lock, the hook rechecks the identity, terminal status, assessment,
and request marker. It records the marker before it blocks. It honors
`stop_hook_active` and fails open on lock contention, malformed input, or I/O
failure. Legacy, opt-out, aborted, paused, observer, and already-requested runs
pass. A hook request does not prove delivery or assessment.

A nonempty stop note suppresses the optional request for that stop. It does not
reopen the terminal run. An explicit stop takes priority, and the skill can
record `DEFERRED` when possible.

### The model chooses consequential work within authority

The assessment asks what could materially improve later outcomes. It does not
reward edit counts or force a small nearby change. One bounded pass can apply
an authorized repair, retain the method with a reason, or preserve a larger
opportunity as an actionable proposal. It cannot recursively optimize itself
or enlarge its own budget.

An agent can make reversible procedural changes within the authorized task
when it preserves the requested result and explicit constraints. Changes to
the result, budget, access, publication, external communication, or unrelated
work require the relevant authority. A graph change still reports first and
requires a distinct `next --accept-graph-change` call.

### Start shares the run lock

A terminal hook can now write the state that a new start replaces. Therefore,
`start` takes the run lock before it checks and replaces existing state. A
stale hook must not mark a new run. This adds serialization to start without
changing the rule that one tree has at most one running run.

## Consequences

- The CLI stores run identity and request state, but it does not invoke a model.
- The host supplies the continuation through its existing account and usage.
- Terminal output remains repeatable and idempotent while it can include an
  unsatisfied assessment notice.
- A direct shell caller can ignore the notice without changing the result.
- External check scripts remain outside the graph fingerprint. Repairing one
  during a run keeps the existing restart guidance.
- Optimization can improve later runs without rewriting the history of the run
  that produced the evidence.
