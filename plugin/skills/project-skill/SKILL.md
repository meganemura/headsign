---
name: project-skill
license: MIT
description: >-
  Write a project-local skill that drives a repository's work by exact shell
  gates, under .agents/skills/. Use when the user asks for a skill the team
  can follow on its own, or to turn an existing workflow's check run strings
  into that skill. Inventing that skill from a repository survey, rather
  than copying a workflow, is create-skill-workflow. This skill writes the
  file and stops.
---

# Write a project-local skill

This skill writes one `SKILL.md` a coding agent can follow with the
repository's own commands. The agent advances only when a gate command
exits 0. The file lives at `.agents/skills/<name>/SKILL.md` unless the
repository already documents a different directory for contributor skills.
Do not write it into a directory the package publishes for downstream users
unless the user says that directory is the contributor skill home.

`create-skill-workflow` is the broader skill. It surveys the repository,
settles what is missing, and invents the local skill. This one copies. When
the user names a workflow file, its check `run` strings become the gates.
When the user asked to invent the skill, or there is nothing to copy, stop
and use `create-skill-workflow`.

This file is the entry. Open the one reference the situation names. Do not
load `references/` up front.

## What this skill does not do

1. It does not design the workflow. Phases and checks that do not exist yet
   are `design-workflow`'s job. If no shell check can decide the work, name
   that and stop.
2. It does not start, continue, or abort a run. Finish at the file.
3. It does not install a program to discover a command. A gate is a command
   the checkout can already run, or one the user named.
4. It does not put the generated skill's gates in that skill's `references/`.
   The agent that drives the skill has to see the shell in `SKILL.md`.
5. It does not invent a local skill from a survey. With no workflow file, it
   uses only commands the user named. Discovering commands, choosing policy,
   and writing the skill is `create-skill-workflow`.

## Write it

Read the workflow file the user names, when one exists. Copy each check's
`run` string into the Gates section. The rules are `references/gates.md`.
The section order is `references/shape.md`.

When no workflow file exists, use only commands the user named, or scripts
they pointed at. Do not invent a check.

After writing, confirm every `run` string appears once, inside a gate fence,
and not again as a second list of commands that must pass.

## Which reference

| Situation | Open |
|---|---|
| Choosing the generated file's sections | `references/shape.md` |
| Copying a gate, a fail route, or a command that must not be a gate | `references/gates.md` |

Inventing the local skill is `create-skill-workflow`. Driving a headsign
run is `workflow`. Designing that workflow is `design-workflow`. Assessing
a finished run is `optimize`. Improving a skill that already exists is
`optimize-skill-workflow`.
