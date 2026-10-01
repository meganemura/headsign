# ADR-0043: Local skills improve their method during work

- Status: accepted
- Date: 2026-10-01
- Applies [ADR-0039](0039-design-for-the-model-that-improves-the-method.md)
  to project-local skill creation and revision.
- Amended by [ADR-0044](0044-skills-only-distribution.md): skills-only
  distribution retires the CLI and hooks. ADR-0038 remains a historical record.

## Context

A local skill can describe the objective, constraints, and available checks.
The model can choose how to use those checks and improve them.
That permits useful work without a fixed phase graph or a stop hook.

Field feedback described repeated AI review corrections after a PR submission.
The agent repaired individual findings while its review method stayed weak.
The local-skill instructions offered assessment at completion or after the same
gate failed twice. They also restricted a single conversation's evidence to
NO_CHANGE or DEFERRED. Those rules delayed useful repairs during the task.

## Decision

Generated local skills require method assessment when feedback exposes a
weakness, and at completion. Review findings can supply that evidence even
when every local gate passes. The model chooses the repair from the evidence.
Critical review of the complete diff is one possible response. It preserves
any requirement for independent review.

The agent applies useful repairs within task authority, finishes the current
work, and verifies affected results. It can add or improve checks while
preserving their required outcomes. A concrete incident can justify a scoped
repair; broader conclusions retain their uncertainty. Useful lessons belong
in the skill, checks, or project documents.

Assessment uses the remaining task budget and honors explicit stops. New
evidence can justify another assessment. Retaining a useful method is valid.
Assessment must not recursively start more improvement work or enlarge its budget.
Work beyond current authority becomes a proposal with a concrete next step.

The existing work record holds the evidence, decision, and verification.
The four disposition labels are optional for local skills.
The skill uses the host's ordinary tools and the project's commands.
ADR-0044 retires the CLI record format and hook continuation from current headsign.

## Consequences

The skill carries a responsibility for improvement while the model chooses
methods, checks, and their order under explicit task constraints.
An authoring-only request finishes after the file and its verification.
When the user also requests a trial or subsequent work, continue that authorized
work after authoring.

This assumes models can diagnose procedural weaknesses from task feedback.
The expected benefit is fewer avoidable review rounds and less human intervention.
Instruction inspection and scenario exercises can check how the guidance reads.
Actual use must establish whether it reduces repeated corrections.
If assessment becomes ceremony or distracts from completion, revise the guidance
using those incidents. Added records or instruction volume are not success measures.
