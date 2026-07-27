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
   iterations), and routing. It never guarantees the *authorship* of
   the artifacts gates read. Who may produce a gate's input is a workflow
   design decision, deliberately left outside the CLI (ADR-0001: the harness
   holds no judgment machinery).

2. **A gate is either measured or judged, and documentation must name which:**
   - **Hard** — the outcome is measured, not authored: test suites, builds,
     type checks, artifact diffs. Nothing the agent writes can fake the exit
     code without doing the work. Nobody authors anything, so the rest of
     this ADR does not apply to these.
   - **Judged** — an LLM produces a verdict and a check reads it. These are
     the ones that need placing, and the line that separates them is **who
     produces the verdict artifact** — not how the judge is started.

3. **Judged gates come in three tiers, hardest first.** The tier is decided
   by the previous sentence's question, and by one follow-up: at what point
   could the working agent have put its own hand on the answer.

   | | Who makes the verdict | Where the worker can intervene |
   |---|---|---|
   | The check itself starts the judge | the judge — no artifact is left behind at all | nowhere; there is nothing to overwrite |
   | The judge writes the verdict file itself | the judge | it can overwrite the file afterwards, but it did not write it |
   | The judge reports and the worker transcribes | the worker | at the moment of writing — that is the act |

   - **Top tier.** `claude -p` inside a check is *one way* to do this, not
     the definition of the tier:

     ```yaml
     - name: independent review
       run: "claude -p 'Review the diff against docs/spec.md. Reply exactly APPROVED or REJECTED.' | tail -1 | grep -qx APPROVED"
       timeout: 600
     ```

     Any check that consumes the judgment as it happens sits here. What makes
     it the hardest tier is that the verdict never becomes a file anyone
     could edit; what it costs is that nothing is left to read afterwards.
   - **Middle tier.** A delegated judge writes the verdict file with its own
     hand and the check greps it. `.headsign/fitness.yaml`'s `judge` phase is
     this: it spawns a subagent whose only writable path is
     `.headsign/tmp/verdict` and gives it a question fixed in the workflow
     file. **This is not enforcement, and the docs must not imply it is** —
     the working agent can overwrite that file afterwards, and nothing in
     headsign would notice. What it removes is the ordinary path to a
     self-approval: the worker is never asked to write the word, so writing
     it is a separate, deliberate act rather than the next step in the
     instructions.
   - **Bottom tier.** The working agent transcribes a verdict it was told —
     the review pattern shipped in `example.headsign/`, and the one the skill
     teaches. The judgment/work separation exists by instruction, not by
     structure. `clear:` and `ready:` protect the verdict's *freshness*, not
     its *honesty*.

   Earlier wording of this ADR called the top tier "semi-hard" and the bottom
   one "soft", and had no name for the middle. Because the top tier was
   introduced through its `claude -p` example, "semi-hard" was read as *use
   that command* rather than *take the pen out of the worker's hand* — a
   misreading that actually happened here. The tiers are stated by
   authorship above for that reason.

4. **Structural hardening is available but not bundled.** Claude Code users
   can deny the working agent Write access to the verdict path with a
   PreToolUse hook and grant it only to the judge. Applied to the middle
   tier, that is what turns its caveat into a guarantee: the worker's
   overwrite stops being possible rather than merely being unasked-for. That
   is harness configuration, not headsign machinery, and stays out of the
   plugin.

5. **The public claim is scoped to the mechanics.** The README banner says
   transitions are deterministic and that the LLM cannot decide them — it
   must not imply gate *inputs* are beyond LLM authorship. The review-gate
   sections state plainly that a review phase is the agent's own discipline,
   not a substitute for human review.

## Consequences

- Anyone choosing a gate can place it on the scale and decide what the phase
  actually proves; the docs stop implying every gate is a test suite.
- Moving a review up the scale is answered by a question about authorship
  rather than by a recommended command: who writes the file. `claude -p` and
  a subagent that writes the verdict itself are two answers to it, and the
  shipped examples now demonstrate both the middle tier
  (`.headsign/fitness.yaml`) and the bottom one (`example.headsign/`).
- Requests to "make verdicts unfakeable" inside headsign are answered here:
  the CLI cannot own authorship without owning execution and identity,
  which is a different, much heavier tool.
