---
name: project-skill
license: MIT
description: >-
  Create a project-local skill from commands or scripts the user names,
  including a file of commands. Preserve their meaning and build the skill
  around the user's completion contract and authority.
---

# Create a skill from named commands

Copy the user's commands accurately. Derive completion from the request and
repository contracts; required CI or review remains part of that contract.
Give the working agent the available gates and their purpose, with freedom
to choose its method within real dependencies, budgets, and approvals.

Read [references/gates.md](references/gates.md) to classify and verify the
named commands. Read [references/shape.md](references/shape.md) to write the
skill's objectives, constraints, evidence, and method-improvement responsibility.

The generated skill must assess its method when feedback exposes a weakness,
and at completion. Choose useful repairs or justified retention. Apply repairs
to the current work, verify affected results, and retain useful lessons within
task authority and remaining budget. Honor explicit stops and required approvals.

Write `.agents/skills/<name>/SKILL.md`, unless the user or repository names
another contributor-skill location. Preserve command provenance and report
unresolved requirements. Do not create queue, ownership, or workflow infrastructure.

Finish after writing the file and verifying its commands appropriately.
Report what was checked and any gaps. If the user requested a trial too,
continue the authorized trial and revise from its evidence.
