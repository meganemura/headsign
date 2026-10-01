# Agent-first assessment

Date: 2026-10-02. Baseline: v0.17.0.

An agent-first tool lets an agent discover its obligations, act within authority,
interpret evidence, hand work to another agent, and repair its method.
The user should not need to reconstruct missing project context for each worker.

## Baseline score: 76/100

This is a qualitative product assessment, not a benchmark success rate.
The weights prioritize reliable continuation alongside freedom to choose a method.
Sources are the maintained skills, current design decisions, and reported migration use.
Reports from consumer work have not been independently replayed for this assessment.

| Dimension | Score | Evidence and limitation |
|---|---:|---|
| Judgment and authority | 19/20 | The skills preserve outcomes, budgets, approvals, and method choice. Model reliability remains uncertain. |
| Discovery and continuation | 11/20 | Migration preserves commands and evidence. Reports describe lost owner decisions, pending review discovery, and selection after work runs out. |
| Checks and actionable results | 13/15 | Guidance distinguishes coverage and unavailable checks. Reports describe manual omissions and command descriptions weaker than implementation. |
| Improvement during work | 12/15 | Assessment and current-work repair are required. Reported workers still made repeated isolated repairs. |
| Delegation and integration | 12/15 | Project guidance separates ownership and evidence. Generated skills need a direct continuation and integration contract. |
| Installation and demonstrated effectiveness | 9/15 | Two standalone directories are easy to distribute. Installed copies can drift, and field evidence for effectiveness is limited. |

These scores identify priorities; they do not rank models or predict a completion probability.

## Changes selected from feedback

### Preserve decisions and unfinished obligations

The authoring skills now name available owner decisions outside workflow files
as migration evidence. Accepted decisions remain distinct from proposals and superseded guidance.
Private decisions stay within their intended audience.

Generated guidance must explain how existing records expose pending required review
and its scope, including additions after a milestone. Empty queues retain their
authorized selection rules or stopping conditions. An empty queue grants no new authority.

These instructions preserve information needed for judgment under
[ADR-0039](adr/0039-design-for-the-model-that-improves-the-method.md) and
[ADR-0044](adr/0044-skills-only-distribution.md).
Projects can use existing work records without adopting a headsign state format.
Durable rules belong in the skill; current progress belongs in project work records.
References to those records let a successor inspect current facts without reconciling copied task snapshots.

### Reassess before another isolated repair

A repair followed by the same cause or related findings calls for method
assessment before another isolated repair. An obvious method defect warrants immediate assessment.
Repeated failing exits alone can have unrelated causes.

This clarifies the timing required by
[ADR-0043](adr/0043-local-skills-improve-during-work.md).
A universal two-failure threshold could delay an already justified repair.
The agent still selects the response and can retain a useful method with evidence.

### Make command contracts usable

Authors compare command guidance with implementation or safe observed behavior.
They resolve differences without silently weakening owner requirements.
An existing aggregate command or a verified project-local runner can reduce manual omissions.
Results must expose individual failures and unrun checks while preserving prerequisites and applicability.

The runner remains optional and project-owned. Its purpose is reliable execution
and useful results; semantic judgment remains with the agent.
This revision adds guidance, not a runner to a consumer project.

### Keep delegation and installation identities explicit

Generated skills identify deliverables, edit ownership, shared resources, and returned evidence when delegation applies.
The parent verifies the integrated result under the original task's authority.

Installation guidance distinguishes authored files, installed copies, link targets,
update sources, and loaded contents. It does not prescribe host configuration changes
or assume that a shared installation points to the authoring checkout.

## Evidence needed to raise the score

The next target is 90/100, contingent on observed work rather than added instructions.

- A fresh worker finds pending review and continuing obligations without owner reconstruction.
- A later task retains applicable owner decisions and handles added work under the correct review scope.
- Repeated findings cause a useful method change before another isolated patch; required outcomes still pass independent review.
- Check aggregation, where adopted, preserves failures, prerequisites, and checks that remain unrun.
- Parallel workers return usable evidence without overwriting shared artifacts; the parent verifies the combined change.
- An installed revision produces the tested behavior across supported hosts, with its source identifiable.

Record interventions, missed obligations, review corrections, and actual completion evidence.
Compare task difficulty and requirements before attributing fewer review rounds to a skill revision.
One successful scenario supports that scenario; it does not establish field reliability.

## Verification of this revision

The contributor check passed with Node 24.18.0. `git diff --check` also passed.
These establish package structure, links, and whitespace properties, not agent reliability.

Isolated trials used a fictional document converter and separate agents:

- Creation produced a skill that identified pending review despite an empty todo count.
  It retained an accepted owner decision and distinguished an unaccepted proposal.
  It checked candidate eligibility against the helper and identified the eligible result.
  The agent executed all three supplied check commands and correctly limited their fixed-pass evidence.
- Improvement produced a skill that called for assessment before another repair of a recurring cause.
  It retained the method for a resolved prerequisite failure with reported acceptance.
  The trial made continuation recommendations; it performed no product repair or product verification.
- A successor read updated records through the generated skill and selected the current candidate.
  It also reported stale progress copied into the skill. The candidate was correct,
  but the copied snapshot imposed avoidable conflict resolution.

The snapshot observation led to explicit separation of durable rules and current progress.
The generated skill was then revised to read progress from existing records.
That final repair received instruction inspection; its effect on later work remains unmeasured.
Independent inspection also found an unconditional handoff trial requirement.
The revision limits that exercise to relevant work or changed continuation and review scope.
The reviewer confirmed the correction and the alignment of the English and Japanese guidance.

The trials used synthetic inputs; they do not measure consumer completion rates.
This evaluation did not implement a consumer runner, test concurrent product work,
or verify installed copies across hosts. Field follow-up remains necessary.
The baseline score remains 76 until evidence supports a revised assessment.

## Approval and continuation follow-up

A later report described ongoing work that stopped after an approval request or progress report.
Independent authorized candidates remained, but the worker treated the wait as a reason to end all work.
The report also described conflicting permission and limit statements after a local rule changed.
The reporter observed continued candidate selection during one or two later cycles; long-term effects remain unknown.
This assessment has not independently replayed that consumer work.

The authoring references now scope a pending approval to its action and dependent work.
They distinguish progress reports from completion of an ongoing assignment.
Small candidates still require judgment about their contribution to the objective.
Further discovery requires the assignment's authority, selection rules, and remaining budget.
Reversible assumptions stay within delegated authority and cannot replace required approval.

This applies ADR-0039 and ADR-0043 without making every task open-ended.
Bounded completion, explicit stops, exhausted budgets, and genuine blockers remain valid boundaries.
A consumer's particular distribution policy remains a local owner decision, not a headsign default.

For rule changes, verification now traces the subject across related instructions,
including permissions, completion conditions, examples, and stated limits.
The author reconciles current guidance while preserving clearly marked historical records.
This addresses inconsistent decisions across paragraphs without adding a runtime or a fixed workflow.

An isolated trial authored a skill for a fictional document converter.
Simulated successors selected a small independent repair, then authorized discovery with earlier evidence and the remaining budget intact.
Counterfactuals stopped for an explicit stop, exhausted budget, completed authoring-only request, or wholly blocked work without discovery authority.
A fresh reader independently selected discovery from the generated skill and an updated work record.
That reader did not inspect the referenced policy or commands; its result establishes instruction interpretation, not executable readiness.
The improvement exercise reconciled preview permissions, examples, and limits while retaining external upload approval.
Fictional commands were not executed; product results were scenario assumptions.
Independent review found no required correction, and the Node 24 contributor check passed.
These results support the tested decisions, not long-term consumer reliability.

## Feedback route follow-up

The owner now has a personal sender skill and a contributor-local receiver skill.
[ADR-0045](adr/0045-feedback-through-existing-sessions.md) defines their boundaries.
The personal installation of improve-project-skill names the sender after verified changes.
The distributed entry honors a user-configured route without requiring that personal setup.

Live discovery found the sender and receiver with readable descriptions.
The current maintainer was the sending session itself, so no message was sent.
An independent agent evaluated six synthetic cases: preferred recipient selection,
provider failure, uncertain delivery, unavailable transport, self-delivery, and sensitive evidence.
Its decisions preserved recipient identity, duplicate prevention, privacy, and continuation.
These were simulated decisions, not actual cross-session delivery.

Both installers listed the two product skills from a candidate distribution tree.
The contributor check passed with Node 24; a broken contributor link failed in a disposable copy.
Independent inspection found no required correction in the feedback route.
Actual delivery across hosts, receiver adoption, and consumer outcomes remain unverified.
Those observations are the next evidence needed; added instructions alone do not raise the score.

## Future assumption

More capable models should need less procedural instruction while still needing
accurate project facts, authority, and evidence. This favors discoverable task records
and composable project commands over a new runtime coordinator.
If the new instructions add ceremony without improving continuation or repair,
simplify them using observed incidents. If obligations remain undiscoverable,
repair their source or project interface within the user's authority.
