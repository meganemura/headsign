---
name: optimize-skill-workflow
license: MIT
description: >-
  Revise a skill that already has a name or a path. Use when it is hard
  to follow, when a gate is prose no command can judge, or when acceptance
  text names a command the checkout cannot run. Prefer a structural or
  gate fix over more instructions. Assessing a finished run is optimize,
  not this skill.
---

# Improve an existing skill

**Done**, for a project-local skill under revision: human-ready. Local
gates have exited 0, CI is green, and AI review is complete. The agent may
loop until Done. Wait and fix actuators are swappable. A CI-wait or a
review-comment loop is not that contract.

**Gates** are exact shell fences in that skill's `SKILL.md`. Exit 0
advances. A prose checklist titled Gate is not a gate.

**Completion criterion:** The description, on its own, says when to read
the skill. The agreed levers are applied. Offer one gate or one loop to
try, and list the levers not taken. Then stop.

Open `references/procedure.md` for finding the file and choosing levers.
Do not load `references/` up front.

`create-skill-workflow` invents a skill. `project-skill` copies named
commands. `optimize` assesses a finished run.
