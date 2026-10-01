# Authoring from repository evidence

Read repository instructions, existing skills, scripts, CI configuration,
and any workflow being replaced. Establish the requested outcome, required
checks and reviews, authority, explicit budgets, and useful evidence.
Ask only about missing information or authority that affects the result.

Distinguish executable checks from implementation work, queue actions, and
standing CI. Show a short inventory with each command's source and purpose.
Copy verified shell strings accurately, including their working directory
and required environment. A name in documentation does not establish that
a checker is available.

## When replacing a workflow

Extract why its gates exist, how their inputs are created, and which updates
completion requires for later checks. Preserve those obligations alongside the
commands. Let the agent choose the method; do not translate states into mandatory
skill steps. Preserve actual dependencies, human approvals, and explicit budgets.
Old run counters describe past execution and do not authorize a new budget.

Inspect helpers by responsibility. A project's checker or queue helper may
remain useful even if its path sits under a former workflow directory.
Preserve it initially when needed to retain evidence or an outcome. State
what must replace it and how to verify that replacement before removal.
Remove runtime-specific dependencies from the generated skill only when
the required outcomes have another verified path. Report any remaining gap.
Use an existing queue when the task needs one; do not invent its replacement.

## Content of the generated skill

Use sections that fit the work rather than a fixed sequence:

- **Purpose and completion.** A precise trigger in `description`, the requested
  result, and the evidence that establishes completion. Preserve requirements
  that lack a checker as explicit gaps. Do not substitute local success for
  required external review or CI.
- **Constraints and authority.** Scope, explicit budgets, approvals, stops,
  and the conditions that need a human decision. Point to standing repository
  policy instead of copying it.
- **Available gates.** Exact executable checks and the properties they test.
  Name needed inputs, dependencies, and evidence. A successful exit proves
  the check's property, not the entire task. Keep helper actions separate.
- **Review and evidence.** Preserve what requires review and who supplies it.
  A separate session, agent, or human provides required independent judgment.
  Self-review and metadata validation serve different purposes. Evidence must
  cover the required review scope, including new, untracked deliverables.
  Bind it to the current revision when required; report unmet requirements honestly.
- **Method improvement.** Include the responsibility below in the generated
  file so it remains available during later work.

## Method improvement to carry into the skill

Assess the method when feedback exposes a weakness, and at completion.
Review findings can reveal missed problems even when all local gates pass.
Ask what the method missed and choose a repair that addresses the cause.
Critical review of the complete change is one option; preserve any required
independent review. Add or improve a gate when it can test the required property.

Choose consequential improvements within task authority and remaining budget.
Preserve required outcomes and approvals, and honor explicit stops. Apply the
chosen repair to the current work, finish the requested result, and verify
affected conclusions. A concrete incident can justify a scoped repair; retain
uncertainty about broader lessons. Retaining a useful method is valid with
a reason. New evidence can justify reassessment; assessment must not create
recursive improvement work or increase its own budget.

Keep reusable lessons in the skill, checks, or project documents. Briefly
report evidence, the decision, and verification in the existing work record
or final handoff. No separate state file or disposition label is required.
Work beyond current authority becomes a proposal with a concrete next step.

## Verify the authored skill

Resolve required command paths and dependencies, and run suitable checks when
authorized and safe. Inspect commands before execution; do not replay commits,
publication, ticket changes, or destructive actions to discover their behavior.
Distinguish a command's availability from a successful run against the work.

New checks are possible when needed and authorized. Verify their implementation
before making them required gates. For migrated checks, exercise affected input
creation and completion updates; one successful invocation can miss these paths.
If no viable checker exists, keep the outcome explicit and report the gap
or required human judgment.
Check that the skill's completion claims match the evidence it can obtain.
