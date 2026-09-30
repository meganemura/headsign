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

Open the one reference this step needs. Do not load `references/` up
front.

| Situation | Open |
|---|---|
| Choosing the generated file's sections | `references/shape.md` |
| Copying a gate, a return, or a command that must not be a gate | `references/gates.md` |

The file lives at `.agents/skills/<name>/SKILL.md` unless the repository
already documents another contributor-skill directory. Do not write into a
directory the package publishes unless the user says that directory is the
contributor skill home.

`design-workflow` writes a headsign workflow. `workflow` walks a run.
`optimize` assesses a finished run. `optimize-skill-workflow` revises a
skill that already exists.
