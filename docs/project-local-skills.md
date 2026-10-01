# Project-local skills

A local skill gives an agent the project's outcome, constraints, and checks.
The model chooses the method and improves it while completing authorized work.
The checks run through the host's ordinary tools.

[日本語](project-local-skills.ja.md)

## Choose the authoring skill

| Skill | Input | Result |
|---|---|---|
| [create-skill-workflow](../skills/create-skill-workflow/SKILL.md) | A repository and an objective; checks still need discovery. | A local skill grounded in the checkout's commands. |
| [project-skill](../skills/project-skill/SKILL.md) | Named commands, scripts, or a file that contains them. | A local skill that preserves those commands and constraints. |
| [optimize-skill-workflow](../skills/optimize-skill-workflow/SKILL.md) | An existing skill and evidence about its use. | A scoped revision, or a reason to retain the method. |

Read the selected entry and the references it names. Keep the complete
directory together when copying it to a host's configured skill directory.
A checkout path works for local development. An older release or plugin cache
can carry older instructions; see [Migration](migration.md).

## Create a skill and use it

An authoring request ends with a usable file and a report of what was checked.
It does not by itself authorize the product work that the file describes.
A request can authorize both: create the skill, then use it for a named task.
Continue with that task when the user has already authorized it.

The generated skill records the requested outcomes, applicable constraints,
available checks, completion evidence, and responsibility for improvement.
Use the consumer repository's skill location and existing conventions.
Use the project's existing queue or ownership convention when the work needs one.
A single authorized task can proceed without inventing a ticket system or
persistent workflow state.

For discovery, inspect the actual scripts, CI, tests, and project instructions.
Name the working directory and prerequisites needed by each command.
Distinguish a command copied from configuration from one actually executed.
Report failed or unavailable checks accurately; keep their required outcomes
visible when execution needs an unresolved prerequisite.

For named commands, preserve the supplied command strings.
A compound shell command is one command; its exit status follows the shell's
operators. Explain an unsafe or misleading status without silently changing
the user's requirements. Inspection of a command is separate from authority
to execute its side effects.

## Gates and evidence

A gate is a check with an observable result used to establish a required
property. Prefer tests, type checks, builds, and other project commands that
inspect the actual work. The model chooses order where the project has not
fixed it. Passing an applicable gate remains a requirement.

A review verdict is a judgment by its author. A command can check its format
and revision, but those checks do not establish the quality or independence
of the review. When independent review is required, the worker's own critical
review adds evidence and does not replace that reviewer.

Bind evidence to the artifact it concerns. Record the revision or diff range
where it matters. After a relevant edit, reassess which results are stale and
rerun the affected checks. Do not replay publication or another external side
effect merely to obtain fresh evidence.

Completion means the requested result is delivered and applicable requirements
are verified. If CI or independent review is required, its current result is
part of completion. Otherwise, do not invent those services as prerequisites.
A missing permission or required result is an explicit limitation, not a pass.

## Improvement during the task

Feedback can reveal a weak method even while all local gates pass.
Repeated review findings warrant examining what the method missed.
An individual incident can justify a narrow repair; broader conclusions need
their uncertainty stated.

Choose a repair by its expected effect on the task. It may be a better test,
a clearer requirement, critical review of the whole diff, or a change to how
evidence is gathered. Preserve the property a gate protects when changing
the gate. Adding a record alone does not repair the method.

Apply the repair to the current work before resubmission or completion.
Check related parts of the change that the same weakness could affect.
Verify affected results and preserve reusable lessons in the skill, checks,
or project documents.

Assess the method again at completion within the remaining task budget.
Retaining a useful method is valid. New evidence can justify another pass;
assessment must not recursively create more improvement work.
Honor the user's stop and seek authority when a repair changes the requested
outcome, explicit budget, publication, access, or unrelated work.

The skills express these responsibilities directly.
[ADR-0039](adr/0039-design-for-the-model-that-improves-the-method.md),
[ADR-0043](adr/0043-local-skills-improve-during-work.md), and
[ADR-0044](adr/0044-skills-only-distribution.md) explain the design.
