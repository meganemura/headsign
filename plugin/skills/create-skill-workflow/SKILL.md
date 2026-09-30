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

**Done** (contract, written into the file's Goals): finish at human-ready.
Every local gate has exited 0, CI is green, and AI review is complete. A
local commit is included when a gate requires one. No push unless the user
asked. The agent may loop until Done. Wait and fix actuators are swappable.

**Steps** are Survey, Settle, Write, and Check. They do not poll CI, reply
to review comments, or install a scheduled agent loop.

**Gates** are exact shell fences in the generated `SKILL.md`. Exit 0
advances. The path above a fence is the agent's. A prose completion line
is not a gate.

**Completion criterion:**

- **Survey.** The user has seen the inventory. Every command is tagged
  gate candidate, tool, or standing CI. The skill file does not exist yet.
- **Settle.** Every gap that changes a required outcome or a constraint
  you cannot choose is settled, from the repository or from an answer that
  carried a default.
- **Write.** The file is on disk at the confirmed path. Its Gates are the
  checkout's exact shell strings. Its Goals state the Done contract. The
  body has no CI-wait, review-comment loop, or scheduled agent loop.
- **Check.** Every gate command resolves on this checkout. Nothing in
  Gates is a prose checklist, a vanished command, or a CI-wait. Then stop.

Open `references/procedure.md` for the work inside each phase. Do not load
`references/` up front.

`design-workflow` writes a headsign workflow. `workflow` walks a run.
`optimize` assesses a finished run. `optimize-skill-workflow` revises a
skill that already exists.
