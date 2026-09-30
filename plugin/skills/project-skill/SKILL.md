---
name: project-skill
license: MIT
description: >-
  Copy shell commands the user named into a project-local skill. Use when
  they name the commands, point at scripts, or name a file that already
  holds those command strings. If the skill still has to be invented from
  the checkout, use create-skill-workflow. Writes the file and stops.
---

# Write a project-local skill

This skill writes one `SKILL.md` a coding agent can follow on its own.
The agent advances only when a gate command exits 0. The file lives at
`.agents/skills/<name>/SKILL.md` unless the repository already documents a
different directory for contributor skills. Do not write it into a directory
the package publishes for downstream users unless the user says that directory
is the contributor skill home.

The gates are shell commands in that file's body. Exit 0 advances. Anything
else does not. The fence is the exact shell string.

`create-skill-workflow` is the broader skill. It surveys the repository,
settles what is missing, and invents the local skill. This one copies
commands that already exist. Lead with the commands the user named, or the
scripts they pointed at. When they name a file that already holds those
commands, copy the shell command strings into the Gates section. When the
user asked to invent the skill, or there is nothing to copy, stop and use
`create-skill-workflow`.

This file is the entry. Open the one reference the situation names. Do not
load `references/` up front.

## What this skill does not do

1. It does not invent checks. If no shell command can decide the work, name
   that and stop. Designing a checked procedure is `design-workflow`.
2. It does not keep driving the job the file describes. Finish at the file.
3. It does not install a program to discover a command. Use the commands
   the user named, or the scripts they pointed at.
4. It does not put the generated skill's gates in that skill's `references/`.
   The agent that drives the skill has to see the shell in `SKILL.md`.
5. It does not invent a local skill from a survey. Discovering commands,
   choosing policy, and writing a skill from the repository is
   `create-skill-workflow`.
6. It does not install a scheduled agent loop, a workflow schedule, or a
   CI-wait procedure. Gates stay exact shell strings in `SKILL.md`.

## Write it

Copy the shell strings exactly. The rules are `references/gates.md`. The
section order is `references/shape.md`. After writing, every command
appears once, inside a gate fence in `SKILL.md`, and not again as a second
list of commands that must pass.

## Which reference

| Situation | Open |
|---|---|
| Choosing the generated file's sections | `references/shape.md` |
| Copying a gate, a return, or a command that must not be a gate | `references/gates.md` |

Inventing the local skill is `create-skill-workflow`. Walking a run is the
`workflow` skill. Designing a checked procedure is `design-workflow`.
Assessing a finished run is `optimize`. Improving a skill that already
exists is `optimize-skill-workflow`.
