# ADR-0039: Design for the model that improves the method

- Status: accepted
- Date: 2026-09-13
- Amends [ADR-0001](0001-thin-harness.md): smallness includes the reasoning
  burden imposed by skills, not just the runtime's responsibilities.
- Governs future changes to the assessment mechanism in
  [ADR-0038](0038-a-run-assesses-its-procedure.md).

## Context

headsign is intentionally small. Its design assumes that models will become
better at choosing methods, diagnosing failures, and revising their own tools.
This is a strategic assumption, not a claim that current models make every
such judgment correctly. A design can prepare for that future while current
execution still preserves explicit requirements and checks.

The intended direction is a harness that keeps sharpening its tools.
Useful work can produce both the requested result and a better method for
later work. The design must give the agent a reason and an opportunity to
consider that second result without turning every task into endless revision.

## Decision

### 1. Put the future model's judgment first

Give the agent the objective, constraints, relevant facts, and authority to
choose a method. Keep semantic judgment with the model: which opportunity
matters, whether a procedure caused a failure, and what repair is appropriate.
Keep runtime decisions tied to observable execution facts and explicit contracts.

Assess each proposed control under a stronger-model assumption. If its purpose
is to compensate for a current reasoning weakness, make it easy to revise or
remove. Preserve requirements such as state consistency and explicit task
authority for as long as those requirements apply.

Skills should carry the context needed for judgment. They should not grow
into exhaustive prescriptions for every observed case. Preserve reasons and
concrete counterexamples so a later agent can reconsider a rule intelligently.
This refines ADR-0001's phrase "Fat Skills": it assigns responsibility, not
a target for instruction volume. ADR-0016's explainability criterion remains.

### 2. Make optimization the default

A run should normally offer an opportunity to improve the means of doing
the work. The agent can repair a workflow, skill, check, integration, or
headsign itself. Retaining a useful method and proposing future work are also
valid outcomes. Optimization by default requires an opportunity for judgment;
it does not require an edit or establish that an improvement occurred.

Continuous improvement extends across tasks. One task uses its existing scope
and remaining budget. Reuse its retrospective findings, respect an explicit
stop, and preserve larger opportunities for later work. Automatic assessment
must not recursively start more assessment work or increase its own budget.

ADR-0038 specifies today's terminal notices, record format, and one attributed
continuation. Those mechanisms can evolve under this policy. Their precise
limits remain in force until an explicit amendment changes them.

### 3. Choose impact before proximity

Choose opportunities by their expected effect on the user's objective and
later outcomes. Examples include preventing repeated errors, reducing necessary
human effort, and enabling work that was previously difficult.
An easy nearby edit does not earn priority merely because it fits immediately.
A consequential proposal with a concrete next step can be the right result.

Do not use counts of edits, lessons, records, or completed improvement tasks
as the definition of success. Explain the expected consequence and uncertainty.
If the opportunity exceeds current authority or budget, preserve it as a
proposal rather than silently expanding the task.

### 4. Allow an explicit bet on changed conditions

A feature can prepare for a future model capability or way of working before
current demand can be measured. State the assumed change, what becomes
necessary when it occurs, and why this design prepares for it.
Current adoption or measured immediate benefit is not a prerequisite for
such a design decision.

This does not waive verification. Test the mechanism's current behavior and
contracts. Keep those results separate from the hypothesis about future value.
Record what would weaken the hypothesis and what could be removed or revised
if it fails. Avoid irreversible commitments that the hypothesis does not need.

### 5. Keep revision within the user's authority

An agent can make reversible procedural changes within the authorized objective
while preserving requested outcomes and explicit constraints. Structural graph
changes do not inherently require another human decision. Changes to outcomes,
explicit budgets, access, external communication, publication, or unrelated work
require the relevant authority.

A fingerprint or acceptance flag does not confer authority. Descriptions and
external scripts can change requirements too. Preserve the reasons for a
check and verify that its replacement still serves the required outcome.
Recheck affected conclusions without automatically replaying side effects.
An earlier completion records the past; it does not validate later edits.

### 6. Keep the harness small as judgment improves

Every added runtime responsibility needs an observable fact or contract to own.
Explain why a skill, a workflow, or the host cannot adequately own it.
Include removal and simplification as normal design outcomes. Smallness covers
runtime responsibilities, configuration, persistent state, and the instructions
an agent must carry. It is not a fixed line-count target.

The host continues to own model execution, conversation, authentication, and
account usage. A design must not introduce separate inference just to assess
a completed run. Host usage remains subject to that host's account conditions;
this boundary makes no promise of free or unlimited inference.

## Applying this decision

For changes to the runtime, skills, or workflow vocabulary, the design rationale
or review should answer the relevant questions below. Routine fixes need only
a short explanation. This is a review responsibility, not a new runtime gate.

- What becomes useful under the assumed future capability or changed condition?
- What consequential outcome does the change serve, and what remains uncertain?
- Which decisions stay with the model, and which observable contract needs code?
- What can be removed, and what evidence would justify revising this choice?
- How are the user's outcomes, authority, budget, and ability to stop preserved?

A proposal that conflicts with this decision must name the conflict and amend
the decision explicitly. A local workaround or accumulated skill instruction
does not silently replace these principles.

## Consequences

The design accepts uncertain future value in exchange for preserving room for
more capable models. It also accepts that an agent may retain the current
method or make a poor proposal. Deterministic runtime tests cannot settle the
quality of that judgment. Concrete experience informs later revisions without
making present demand the sole basis for choosing the direction.
