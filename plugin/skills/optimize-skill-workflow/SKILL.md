---
name: optimize-skill-workflow
license: MIT
description: >-
  Improve an existing skill the user names. Use when a workflow skill is
  hard to follow, when its gates require a runtime the skill claims not to
  need, or when acceptance text names a command the checkout cannot run.
  Assessing a finished headsign run is optimize, not this skill.
---

# Improve an existing skill

This skill revises a skill that already exists. It does not keep driving
that skill's daily job. The paired authoring skill is
`create-skill-workflow`, which writes a new local skill. This one starts
from a name or a path the user gave.

`optimize` assesses a finished headsign run and writes that run's
disposition. It is a different skill. Do not use this one to fill in
`assessment.md`, and do not use `optimize` when the user asked to edit a
skill file.

This file is the entry. Open the one reference the situation names. Do not
load `references/` up front.

## What this skill does not do

1. It does not rewrite the skill before the diagnosis and the agreed
   scope.
2. It does not edit an installed plugin or a managed catalog copy. Those
   are read-only. A fork into the repository, or into a skill home the
   host lets you write, is the proposal.
3. It does not add a required gate that no command can judge, and it does
   not leave a vanished command in place and call the sync done.
4. It does not keep going through diagnosis items the user did not pick.

## Revise it

Open `references/procedure.md` and follow it.

Agree one to three changes. Apply those. A useful method can stay. Show
what changed, name one small way to try the skill, and list what you left.

## Which reference

| Situation | Open |
|---|---|
| Finding the skill, diagnosing it, and applying the agreed edits | `references/procedure.md` |

Writing a new local skill is `create-skill-workflow`. Copying a
workflow's gates into one is `project-skill`. Assessing a finished run is
`optimize`.
