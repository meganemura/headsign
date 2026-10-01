# Content of the generated skill

Use the sections the work needs. Do not turn their order into a required
execution sequence. The description states when to use the skill; the body
adds the context needed to choose and complete the work.

- **Goals.** The requested result and evidence of completion. Derive required
  checks, review, CI, and delivery from the user and repository contracts.
  Identify unmet requirements instead of silently dropping them.
- **Constraints.** Scope, budgets, approval boundaries, and stop conditions.
  Point to existing policy. Ask when missing information or authority prevents
  completion; an unavailable check does not authorize a weaker outcome.
- **Available gates.** The named commands, their sources, and the properties
  they test. Preserve input creation, dependencies, and updates required at
  completion to keep later checks meaningful. Keep actions separate from checks.
- **Evidence and review.** Preserve what requires review and its relation to
  the current change, including new, untracked deliverables within that scope.
  A separate session, agent, or human supplies required independent review.
  Metadata validation does not establish reviewer independence. Report unmet
  review requirements when only self-review is available.
- **Method improvement.** Include the responsibility below in the generated file.

## Method improvement to carry into the skill

Assess the method when feedback exposes a weakness, and at completion.
Review corrections can expose problems even when all local checks pass.
Ask why the method missed the issue and choose a repair from the evidence.
Critical review of the complete change is one option; it preserves required
independent review. During later work, add or improve gates when useful and
authorized, while preserving required outcomes and verifying new checks.

Apply chosen repairs to the current work, finish the requested result, and
verify affected conclusions. One concrete incident can justify a scoped repair;
retain uncertainty about broader lessons. A useful method may stay with a
reason. Keep reusable lessons in the skill, checks, or project documents.

Stay within task authority and remaining budget, honor required approvals and
explicit stops, and propose larger work with a concrete next step.
Reassess when new evidence warrants it; avoid recursive improvement work or
an increase to the task budget. Briefly report evidence, the decision, and
verification in the existing work record or handoff. Dedicated state and
disposition labels are not required.
