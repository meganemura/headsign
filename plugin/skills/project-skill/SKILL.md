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

**Done** (written into the generated Goals): finish at human-ready. Every
local gate has exited 0, CI is green, and AI review is complete. A local
commit is included when a gate requires one. No push unless the user
asked. The agent may loop until Done. Wait and fix actuators are swappable.

**Gates** are the exact shell strings the user named, fenced in the
generated `SKILL.md`. Exit 0 advances. Do not paraphrase a string. A prose
completion line is not a gate.

**Completion criterion:** Every named command appears once, inside a gate
fence in that `SKILL.md`, and not again as a second list. Then stop.

The file lives at `.agents/skills/<name>/SKILL.md` unless the repository
already documents another contributor-skill directory. Do not write into a
directory the package publishes unless the user says that directory is the
contributor skill home.

Open the one reference this step needs. Do not load `references/` up
front.

| Situation | Open |
|---|---|
| Choosing the generated file's sections | `references/shape.md` |
| Copying a gate, a return, or a command that must not be a gate | `references/gates.md` |

`design-workflow` writes a headsign workflow. `workflow` walks a run.
`optimize` assesses a finished run. `optimize-skill-workflow` revises a
skill that already exists.
