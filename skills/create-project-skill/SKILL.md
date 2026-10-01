---
name: create-project-skill
license: MIT
description: >-
  Create a project-local skill from objectives, constraints, and repository
  evidence or supplied commands. Use when setting up agent work or replacing
  a workflow with a skill. For an existing skill, use improve-project-skill.
---

# Create a project-local skill

Give the working agent the objective, constraints, available gates, and
authority to choose its method. Derive completion from the user's request
and repository contracts. CI, independent review, commits, or publication
belong in completion only when those contracts require them.

Read [references/procedure.md](references/procedure.md) before authoring.
Inspect the repository and preserve the provenance of its commands and
requirements. Explain material gaps before treating the skill as usable.
Preserve supplied command strings and their meaning. Discover missing checks
when the request permits it; a copy-only request does not authorize additions.
Do not impose a phase graph or create queue or ownership infrastructure.

The generated skill must require method assessment when meaningful feedback
exposes a weakness, and at completion. The agent chooses a useful repair or
justified retention within task authority and remaining budget. It applies
repairs to the current work, verifies affected results, and preserves useful
lessons. Explicit stops and required approvals continue to govern the work.

Write to `.agents/skills/<name>/SKILL.md`, unless the user or repository names
another contributor-skill location. Check that location's ignore and package rules.
Keep the skill usable with the project's own tools;
it must not depend on this authoring skill after generation.

Finish when the file expresses the contract, required commands are verified
appropriately, and unresolved gaps are reported. Report what was checked.
If the user also requested a trial, continue that authorized trial and use
its observations to revise the skill.
