# Create from repository evidence and supplied commands

Read repository instructions, existing skills, scripts, CI configuration,
and any workflow being replaced. Establish the requested outcome, required
checks and reviews, authority, explicit budgets, and useful evidence.
Ask only about missing information or authority that affects the result.

Include applicable owner decisions from available conversations, memory,
handoffs, and reviews. Separate accepted decisions from proposals and superseded
guidance. Resolve material conflicts; report inaccessible context as a gap.
Keep decisions within their intended audience and make them discoverable to
the next worker. Do not require a particular memory service or exhaustive history search.

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

Preserve how another agent finds unfinished obligations from existing work
and evidence. Explain how to identify implemented work awaiting required review,
the scope each review covers, and what invalidates that coverage.
For work added after a milestone, identify the added scope that needs review.
When the current queue is empty, preserve authorized selection rules or the
stopping condition. An empty queue does not itself authorize more work.
Use existing records; do not require a new status vocabulary or state store.
Keep durable rules in the skill and current progress in the project's work records.
Reference those records instead of copying task snapshots into reusable instructions.

## Content of the generated skill

Use sections that fit the work rather than a fixed sequence:

- **Purpose and completion.** A precise trigger in `description`, the requested
  result, and the evidence that establishes completion. Preserve requirements
  that lack a checker as explicit gaps. Do not substitute local success for
  required external review or CI.
- **Constraints and authority.** Scope, explicit budgets, approvals, stops,
  and the conditions that need a human decision. Point to standing repository
  policy instead of copying it.
  A pending approval blocks that action and its dependent work; continue independent work already authorized.
  Reversible choices within delegated authority can use recorded assumptions; reversibility does not waive an explicit approval.
- **Available gates.** Exact executable checks and the properties they test.
  Name applicability, needed inputs, dependencies, and evidence. A successful
  exit proves the check's property, not the entire task. Keep helper actions separate.
  Prefer an existing aggregate command when it preserves those contracts.
  Repeated manual omissions can justify a small project-local runner within authority.
  Its output must identify each check's result and any checks left unrun.
  Verify failure propagation, prerequisites, and conditional checks before relying on it.
- **Review and evidence.** Preserve what requires review and who supplies it.
  A separate session, agent, or human provides required independent judgment.
  Self-review and metadata validation serve different purposes. Evidence must
  cover the required review scope, including new, untracked deliverables.
  Bind it to the current revision when required; report unmet requirements honestly.
- **Continuation and delegation.** Identify where a successor finds remaining
  obligations and evidence. For ongoing assignments, a progress report alone does not complete the work.
  Distinguish bounded completion, explicit stops, exhausted budgets, and blockers that prevent all authorized continuation.
  Evaluate small candidates by their contribution to the objective, not size alone.
  Discover further candidates only when the assignment authorizes it; preserve its selection rules and limits.
  When delegating, specify deliverables, edit ownership,
  shared resources, and evidence to return. The parent verifies the integrated result.
- **Method improvement.** Include the responsibility below in the generated
  file so it remains available during later work.

## Method improvement to carry into the skill

Assess the method when feedback exposes a weakness, and at completion.
Review findings can reveal missed problems even when all local gates pass.
Ask what the method missed and choose a repair that addresses the cause.
When a repair leaves the same failure cause or related review findings,
reassess the cause, scope, and method before another isolated repair.
An evident method defect warrants assessment on its first occurrence.
Repeated nonzero exits alone do not establish a shared cause.
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

Read the skill, required references, and affected guidance together for conflicting rules.
When a rule changes, trace its subject across permissions, completion conditions, examples, and stated limits.
Reconcile current guidance with the accepted decision; preserve clearly marked historical records.

Resolve required command paths and dependencies, and run suitable checks when
authorized and safe. Inspect commands before execution; do not replay commits,
publication, ticket changes, or destructive actions to discover their behavior.
Distinguish a command's availability from a successful run against the work.
Compare guidance about named commands with their implementation or safe observed
behavior, especially selection rules, ordering, side effects, and failure results.
Resolve mismatches explicitly; do not silently relax requirements to match code.
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
For work that needs continuation or delegation, exercise a handoff using existing
records: identify the next obligation, its evidence, and authority to proceed.
Include pending review or exhausted work when relevant.
Report inspection, scenario behavior, and actual work separately.
