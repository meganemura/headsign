---
name: create-skill-workflow
license: MIT
description: >-
  Invent and write a project-local workflow skill the team can follow with
  the repository's own commands. Use when setting a repository up for agent
  work, or when repeated CI failures should be absorbed by a local skill
  whose gates are commands the checkout can run. Copying an existing
  workflow's check run strings into that file is project-skill. This skill
  writes the file and stops.
---

# Invent a project-local workflow skill

This skill writes one skill a coding agent can follow with the repository's
own commands. The people who use that skill follow the file. They do not
need the headsign program to run it. Hook enforcement is a later proposal,
only when look-backs show the gates keep being ignored.

`project-skill` is the narrower job. A workflow file already exists, and the
task is to copy its check `run` strings into
`.agents/skills/<name>/SKILL.md` and stop. This skill is the broader one.
It surveys the repository, settles what is missing with the user, and
invents the local skill.

This file is the entry. Open the one reference the situation names. Do not
load `references/` up front.

## What this skill does not do

1. It does not keep driving the job the local skill describes. Finish at
   the file, a pointer the user asked for, and one first job they could try.
2. It does not require the team to install an orchestrator, and it does not
   put an orchestrator's state on a gate.
3. It does not invent a command. A gate is a command the checkout can run
   now. A missing tool stays a candidate in the tool menu.
4. It does not decide the workflow before the survey, and it does not fix
   the agent's path line by line.

## Write it

Open `references/procedure.md` and follow it.

The local skill gives the agent an objective, the constraints, and the
tools that exist. The agent chooses the path. Where a command can decide
the work, Done is that command's exit code.

## Which reference

| Situation | Open |
|---|---|
| Surveying, asking, writing, and checking the local skill | `references/procedure.md` |

Copying an existing workflow's check `run` strings is `project-skill`.
Designing a headsign workflow is `design-workflow`. Walking that run is
`workflow`. Assessing a finished run is `optimize`. Improving a skill that
already exists is `optimize-skill-workflow`.
