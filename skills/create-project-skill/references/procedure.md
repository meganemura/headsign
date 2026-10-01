# Create from repository evidence and supplied commands

Read repository instructions, existing skills, scripts, CI configuration,
and any workflow being replaced. Establish the requested outcome, required
checks and reviews, authority, explicit budgets, and useful evidence.
Ask only about missing information or authority that affects the result.

Distinguish executable checks from implementation work, queue actions, and
standing CI. Show each command's source, purpose, and conditions that require it.
Copy shell strings accurately, including flags, operators, working directory,
and required environment. A name in documentation does not establish that
a checker is available. Keep human judgment explicit when a command cannot
establish a required property.

When the user supplies commands, scripts, or a file of commands, read those
sources and preserve their meaning. Explain unsafe behavior or misleading
exit status without silently changing the commands. A copy-only request does
not authorize adding or replacing checks. Report missing coverage as a gap.
Broader authority can permit a verified repair while preserving required outcomes.
Command order alone does not require an execution sequence; preserve actual
dependencies and any order the user explicitly requires.

## Choose the destination

Inspect ignore rules and package contents for the intended skill location.
Contributor guidance must reach the intended agents. Include it in product
distribution only when the project requires that. If the location shares a
directory with product assets, preserve those assets when adjusting package rules.
Verify changed distribution contents with a safe local check.

## When replacing a workflow

Extract why its gates exist, how their inputs are created, and which updates
completion requires for later checks. Preserve those obligations alongside the
commands. Let the agent choose the method; do not translate states into mandatory
skill steps. Preserve actual dependencies, human approvals, and explicit budgets.
Old run counters describe past execution and do not authorize a new budget.
Trace configuration that connects checks to their intended test services.
For checks that change local data, specify preparation for each attempt and
protect existing data with an isolated test location.
Identify shared check artifacts that need task ownership or isolation.

Inspect helpers by responsibility. A project's checker or queue helper may
remain useful even if its path sits under a former workflow directory.
Read their implementations for constraints on published content and completion
reports, even when the current task does not authorize those actions.
Preserve useful helpers initially to retain evidence or an outcome. State
what must replace it and how to verify that replacement before removal.
Remove runtime-specific dependencies from the generated skill only when
the required outcomes have another verified path. Report any remaining gap.
Check product callers before removing an artifact or dependency. Preserve
inputs that still serve a product contract, and label historical instructions.
Use an existing queue when the task needs one; do not invent its replacement.
Preserve its lookup and selection rules. Keep local-only command details in
discoverable local instructions rather than moving them into public guidance.

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
  Name applicability, needed inputs, dependencies, and evidence. A successful
  exit proves the check's property, not the entire task. Keep helper actions separate.
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
Confirm that a check examines the work its result is meant to verify.
Report required work left unexamined, including gaps behind a successful zero-input result.

New checks are possible when needed and authorized. Verify their implementation
before making them required gates. Compare the work that requires each migrated
check before and after the change. Exercise affected input
creation and completion updates, including a later task with earlier evidence
still present. One successful invocation can miss these paths.
If no viable checker exists, keep the outcome explicit and report the gap
or required human judgment.
Check that the skill's completion claims match the evidence it can obtain.
