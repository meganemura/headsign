# ADR-0044: Distribute skills without a workflow runtime

- Status: accepted
- Date: 2026-10-01
- Revised: 2026-10-01, after v0.16.0: unify creation and name both skills by their purpose.
- Applies [ADR-0039](0039-design-for-the-model-that-improves-the-method.md).
- Retains [ADR-0043](0043-local-skills-improve-during-work.md)'s improvement responsibility.
- Supersedes the runtime and distribution contracts in ADR-0001 through
  ADR-0038 and ADR-0040 through ADR-0042 for current headsign.
- Amends ADR-0019 and ADR-0020's documentation and authoring boundaries,
  and ADR-0043's allowance for hooks and historical CLI assessments.

## Context

headsign began with a thin runtime that held state and executed gates while
the model did the work. Better models can choose their method from objectives,
constraints, and available checks. The owner chose to end CLI and npm
distribution and use ordinary skills without hooks.

Field feedback exposed a weakness that remains relevant: an agent can repair
each review finding while failing to improve the method that missed them.
ADR-0043 therefore requires assessment during work and at completion,
application of useful repairs to current work, and verification of affected
results. Removing the runtime retains that responsibility.

## Decision

### Two skills are the product

Distribute `create-project-skill` and `improve-project-skill`.
They create or repair project-local skills using the project's actual commands.
The model chooses the method and order within explicit requirements.

The v0.16.0 decision retained three names for existing users.
The owner subsequently approved merging `create-skill-workflow` and
`project-skill` into `create-project-skill`, and renaming
`optimize-skill-workflow` to `improve-project-skill`.
This amendment replaces the name-stability commitment. Old names have no aliases.

The model can determine which checks the user supplied and which need discovery.
One creation entry preserves supplied commands, identifies gaps, and discovers
additional checks within the request's authority. A copy-only request remains
copy-only. Improvement retains its own entry for requests about an existing skill.
Generated skills still assess their method during work and at completion;
they do not wait for a separate improvement request.

Remove the CLI, runtime state machine, hook implementations, host overlays,
runtime workflows, and npm publication process from the maintained tree.
Distribute ordinary directories under `skills/`.
Remove plugin manifests, marketplace registration, and package manifests.
Git tags and CHANGELOG identify releases.
Consumers need the selected skill directory, its references, and their own
project tools. They need no headsign installation or build.

An earlier draft retained passive plugin packaging for compatibility.
The owner explicitly rejected that compatibility before release.
Ordinary skill installers can discover the directories without those manifests.

The contributor check uses Node's standard library without package dependencies.
`node scripts/check.ts` checks the maintained repository with Node 24.
The check supplies structural evidence; it does not judge whether a model's
method is effective. Behavioral evaluation uses relevant scenarios and real
work within existing authority.

### Improvement is part of doing the work

Generated skills require assessment when feedback exposes a procedural
weakness, and at completion. The model chooses useful repairs, applies them
to the current task, and verifies affected results.
The agent may add or improve gates while preserving required outcomes.
Keeping a useful method is a valid decision.

The task's remaining budget bounds assessment. It cannot recursively start
new assessment work or enlarge its budget. User stops, access boundaries,
independent-review requirements, and publication authority remain binding.
The existing work record can hold evidence and decisions without a headsign
assessment identity, disposition format, or continuation hook.

### Authoring and execution follow the request

Creating a skill alone does not authorize its product work.
A request that includes creation and subsequent use authorizes both.
After authoring, continue the already-authorized task with the new skill.
Do not make a file-only boundary interrupt a request that includes execution.

The README explains the product and entry points. Skill directories carry
agent instructions. Current guides explain use, migration, and maintenance.
Historical ADRs and versioned source preserve runtime rationale.
[Workflow lessons](../workflow-lessons.md) brings relevant knowledge forward
without requiring old transition mechanics.

### Migration preserves work and authority

Read the consumer's active work and constraints before removing integration.
Preserve history and unfinished work. Translate runtime-dependent checks
deliberately; their required properties can outlive the runtime.
Remove only headsign-specific hooks and configuration within authorized scope.
Existing published artifacts and tags remain intact.
Registry deprecation and external publication require separate approval.

## Future assumption and verification

The design assumes models will improve at selecting checks, diagnosing method
failures, and completing work from objectives and constraints.
The expected value is less configuration and state to maintain while useful
checks and improvement responsibilities remain.

This is a product decision under uncertainty. A successful instruction review
does not establish reliable task completion. Repeated missed checks or
unresolved review loops are reasons to reconsider the instructions and tools.
A future proposal for runtime enforcement must establish its need and amend
this decision explicitly.

Validation must check the skill package and exercise changed instructions.
Reports must distinguish inspected instructions, simulated
scenarios, and observations from actual work.

## Consequences

The host owns model execution, permissions, account usage, and session control.
The project owns its outcomes and verification commands.
headsign maintains instructions and knowledge instead of runtime accounting.

Existing CLI users need a deliberate migration. Old plugin caches can retain
hooks and instructions until their integration changes.
Historical runtime contracts apply to their old versions, not current skills.
The earlier ADRs remain readable records rather than instructions to restore
the retired implementation.
