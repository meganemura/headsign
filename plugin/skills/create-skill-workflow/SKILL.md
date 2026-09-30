---
name: create-skill-workflow
license: MIT
description: >-
  Invent a project-local skill from the checkout when the gate commands
  are not named yet. Use when setting a repository up for agent work, or
  when repeated failures should land in a local skill whose gates are
  shell commands this checkout can run. Named commands, scripts, or a
  file of those command strings are project-skill. Writes the file and
  stops.
---

# Invent a project-local skill

This skill writes one skill a coding agent can follow with the repository's
own commands. The gates are shell commands in that skill's `SKILL.md`.
Exit 0 advances. Anything else does not.

Finish at the file. The file's Done is human-ready, specified in the
procedure. This pass does not run that job.

`project-skill` is the narrower job. The user has named the commands, or
pointed at scripts, or named a file that already holds those command
strings. The task is to copy those strings into
`.agents/skills/<name>/SKILL.md` and stop. This skill is the broader one.
It surveys the repository, settles what is missing with the user, and
invents the local skill.

This file is the entry. Open the one reference the situation names. Do not
load `references/` up front.

## What this skill does not do

1. It finishes at the file, a pointer the user asked for, and one first
   job they could try. Waiting on CI and applying review fixes are not
   this pass.
2. It does not put another program's state on a gate. The gate is a product
   command.
3. It does not invent a command. A gate is a command the checkout can run
   now. A missing tool stays a candidate in the tool menu.
4. It does not decide the procedure before the survey, and it does not fix
   the agent's path line by line. The fence is the exact shell string. The
   path is the agent's choice.

## Write it

Open `references/procedure.md` and follow it. Survey, Settle, Write, and
Check each end at the completion criterion in that file.

## Which reference

| Situation | Open |
|---|---|
| Surveying, settling, writing, and checking the local skill | `references/procedure.md` |

Copying commands the user named is `project-skill`. Designing a checked
procedure is `design-workflow`. Walking a run is `workflow`. Assessing a
finished run is `optimize`. Improving a skill that already exists is
`optimize-skill-workflow`.
