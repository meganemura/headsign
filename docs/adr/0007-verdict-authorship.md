# ADR-0007: Verdict authorship — why soft gates are soft

- Status: accepted
- Date: 2026-07-25

## Context

headsign's central promise is deterministic judgment: a phase moves only on
shell exit codes and routing, never on an LLM's say-so. An external review
pointed at a real tension in that promise: the flagship review pattern gates
on `grep -qx APPROVED .headsign/tmp/verdict`, and the verdict file is
written by the working agent itself (transcribing a read-only reviewer's
report). The transition is deterministic; the **artifact it reads is
LLM-authored**. A worker cornered at attempt 3/3 faces no structural barrier
to writing `APPROVED` — only the discipline the skill teaches. Tests are
strong gates precisely because their outcome cannot be authored; a verdict
is precisely an authorable outcome.

This is not an implementation bug to patch — it is a boundary to name.

## Decision

1. **What headsign guarantees is the determinism of the *mechanics*:**
   evaluation (checks run, exit codes read), accounting (attempts,
   iterations, cache), and routing. It never guarantees the *authorship* of
   the artifacts gates read. Who may produce a gate's input is a workflow
   design decision, deliberately left outside the CLI (ADR-0001: the harness
   holds no judgment machinery).

2. **Gates therefore come in three hardness classes, and documentation must
   name them honestly:**
   - **Hard** — the outcome is measured, not authored: test suites, builds,
     type checks, artifact diffs. Nothing the agent writes can fake the exit
     code without doing the work.
   - **Semi-hard** — the judgment is made *outside the working agent's
     context*: the check itself invokes another LLM as a judge, e.g.

     ```yaml
     - name: independent review
       run: "claude -p 'Review the diff against docs/spec.md. Reply exactly APPROVED or REJECTED.' | tail -1 | grep -qx APPROVED"
       timeout: 600
     ```

     The transition stays deterministic (an exit code); the judge never sees
     the worker's context or incentives. The judgment itself is still an
     LLM's — semi, not hard.
   - **Soft** — the working agent transcribes a verdict (the default review
     pattern). The judgment/work separation exists by instruction (the skill
     mandates a read-only reviewer), not by structure. `clear:` and `ready:`
     protect the verdict's *freshness*, not its *honesty*.

3. **Structural hardening is available but not bundled.** Claude Code users
   can deny the working agent Write access to the verdict path with a
   PreToolUse hook and grant it only to the reviewer, moving the review from
   soft to semi-hard. That is harness configuration, not headsign machinery,
   and stays out of the plugin.

4. **The public claim is scoped to the mechanics.** The README banner says
   transitions are deterministic and that the LLM cannot decide them — it
   must not imply gate *inputs* are beyond LLM authorship. The review-gate
   sections state plainly that a review phase is the agent's own discipline,
   not a substitute for human review.

## Consequences

- Anyone choosing a gate can place it on the hardness scale and decide what
  the phase actually proves; the docs stop implying every gate is a test
  suite.
- The `claude -p` judge pattern is documented as the zero-machinery way to
  take the pen out of the worker's hand when it matters.
- Requests to "make verdicts unfakeable" inside headsign are answered here:
  the CLI cannot own authorship without owning execution and identity,
  which is a different, much heavier tool.
