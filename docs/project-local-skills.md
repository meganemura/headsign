# Project-local skills

A local skill gives an agent the project's outcome, constraints, and checks.
The model chooses the method and improves it while completing authorized work.
The checks run through the host's ordinary tools.

[日本語](project-local-skills.ja.md)

## Choose the authoring skill

| Skill | Input | Result |
|---|---|---|
| [create-project-skill](../skills/create-project-skill/SKILL.md) | A repository and objective, with any supplied commands or scripts. | A local skill grounded in project evidence that preserves supplied command meaning. |
| [improve-project-skill](../skills/improve-project-skill/SKILL.md) | An existing project-local skill and evidence about its use. | A scoped revision, or a reason to retain the method. |

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

Carry applicable owner decisions from available conversations, memory, handoffs,
and reviews into guidance within the same privacy boundary. Distinguish accepted
decisions from proposals and superseded guidance.
For continuation, explain how existing records identify implemented work awaiting
required review and the scope that review must cover, including later additions.
Preserve authorized selection rules or stopping conditions when work runs out.
Keep durable rules in the skill and current progress in the project's work records.
Refer to those records rather than copying task snapshots into reusable instructions.
When delegating, identify deliverables, edit ownership, shared resources, and
returned evidence. The parent remains responsible for the integrated result.

A pending approval blocks that action and its dependent work, while independent authorized work can continue.
Recorded assumptions can support reversible choices within delegated authority; they do not replace explicit approval.
For ongoing assignments, a progress report alone does not complete the work.
Preserve bounded completion, explicit stops, budgets, and blockers that prevent all authorized continuation.
Evaluate small candidates by their contribution; discover more only within the assignment's selection rules and authority.

For discovery, inspect the actual scripts, CI, tests, and project instructions.
Name the working directory and prerequisites needed by each command.
Distinguish a command copied from configuration from one actually executed.
Report failed or unavailable checks accurately; keep their required outcomes
visible when execution needs an unresolved prerequisite.
Compare descriptions of named commands with their implementation or safe observed behavior.
An existing aggregate command or a small project-local runner can reduce manual
omissions. Preserve each check's applicability and expose failures and unrun checks.
Creating a runner requires task authority and verification; it is optional.

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
If a repair leaves the same cause or related findings, reassess before another
isolated repair. An evident method defect warrants assessment on its first occurrence.
Repeated nonzero exits alone do not establish a shared cause.
An individual incident can justify a narrow repair; broader conclusions need
their uncertainty stated.

Choose a repair by its expected effect on the task. It may be a better test,
a clearer requirement, critical review of the whole diff, or a change to how
evidence is gathered. Preserve the property a gate protects when changing
the gate. Adding a record alone does not repair the method.

Apply the repair to the current work before resubmission or completion.
Check related parts of the change that the same weakness could affect.
For a changed rule, read the skill, required references, and affected guidance together.
Trace the subject across permissions, completion conditions, examples, and stated limits to reconcile current instructions.
Keep historical records clearly marked rather than rewriting past decisions.
Verify affected results and preserve reusable lessons in the skill, checks,
or project documents.

Assess the method again at completion within the remaining task budget.
Retaining a useful method is valid. New evidence can justify another pass;
assessment must not recursively create more improvement work.
Honor the user's stop and seek authority when a repair changes the requested
outcome, explicit budget, publication, access, or unrelated work.

After a verified revision, use a user-configured feedback route for reusable findings.
Generalize sensitive material before sending it outside its original boundary.
Report delivery separately from adoption and continue authorized work without waiting for a reply.
Contributors to headsign use its project-local improve-headsign skill to assess received evidence.

The skills express these responsibilities directly.
[ADR-0039](adr/0039-design-for-the-model-that-improves-the-method.md),
[ADR-0043](adr/0043-local-skills-improve-during-work.md), and
[ADR-0044](adr/0044-skills-only-distribution.md) explain the design.
