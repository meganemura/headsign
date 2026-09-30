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

Open `references/procedure.md` and follow it. Do not load `references/`
up front.

`design-workflow` writes a headsign workflow. `workflow` walks a run.
`optimize` assesses a finished run. `optimize-skill-workflow` revises a
skill that already exists.
