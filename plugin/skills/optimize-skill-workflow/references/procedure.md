# Revising the skill

The entry states the seam with `optimize`. This file is the pass from a
named skill to a small diff.

## Contents

1. [Find the file](#1-find-the-file)
2. [Read it](#2-read-it)
3. [Choose the change](#3-choose-the-change)
4. [Write the diff](#4-write-the-diff)
5. [Stop](#5-stop)
6. [Do not](#do-not)
7. [Against create-skill-workflow](#against-create-skill-workflow)

## 1. Find the file

The user names it, gives a path, or points at the one just discussed.
Search in this order and stop at the first real file. If two remain
possible, ask once and pick one.

| Where it lives | How to find it |
|---|---|
| A shared skill home the host documents as writable | The host's catalog, or a directory listing |
| An installed plugin or a managed catalog | The catalog's absolute path. Read it. Do not edit it |
| The repository | `.agents/skills/<name>/SKILL.md`, or the path the team documents |

When the file is an installed plugin or a managed copy, the change is a
fork into the repository or into a writable skill home. Leave the
installed file alone.

## 2. Read it

Read the frontmatter (`name`, `description`) and the body before changing
anything. When they matter, also read the neighboring references, the
callers (AGENTS.md, a routine, a parent skill), and the commands that the
queue and the acceptance text name.

The description owns the trigger. If the body restates when to use the
skill, the repair is the description, not a longer introduction.

Give the user a short diagnosis, three to seven points. Look for these
first:

- The description does not say when to use the skill.
- The steps are thick, and the agent cannot choose a tool. A numbered
  procedure whose completion line is prose, with no shell command, is
  this.
- Done is the agent's report, and no command can disagree. Human-ready
  Done is local gates at exit 0, CI green, and AI review complete, when
  this skill is a project-local one.
- A checklist titled Gate that cannot exit 0, or a completion line with
  no shell string.
- A command or a path disagrees with the checkout, or a checker name that
  is gone remains in Gates or in acceptance text.
- A gate string that was paraphrased. The fence wants the exact shell
  string. The path above it stays the agent's choice.
- A runtime dependency contradicts the purpose. A skill that claims to
  run on the repository's own commands still requires another program's
  state on a gate.
- A scheduled agent loop, a workflow schedule, or a CI-wait procedure
  written into a skill that should run on the repository's own commands.
- A soft preference copied into a required gate.
- Independent review is only two roles in one session, and no command
  checks the verdict.
- Ownership depends on reading another program's state, where a thin
  gitignored file such as `loop.json` would do.
- A channel, a repository, or a person's name that belongs to one
  assistant is baked into a shared skill.
- One skill both audits and edits, and a split would make each job clearer.
- A local skill is missing a section `create-skill-workflow` requires:
  Goals, Gates, Tool menu, Evidence, or Self-improve. Gates belong in
  `SKILL.md`.
- Self-improve only appends prose, where a check or a script could
  enforce the lesson, or it proposes hook enforcement before look-backs
  have shown the same gate being ignored.
- The same policy is kept in `SKILL.md` and again in a reference, in
  AGENTS.md, or in another skill.

## 3. Choose the change

Do not fix the whole list. Agree with the user which one to three items
happen now.

When several levers fit, prefer the one that changes a check, a script, or
a gate. A longer skill is the lever you did not pick. Explore the checkout
before you ask, and bring a recommended default with the question.

Use a lever only when the diagnosis named it:

| Lever | What changes |
|---|---|
| Structuralize | A repeated prose rule becomes a check, a script, or a gate |
| Classify | A local exit-0 command stays a gate. A helper moves to the tool menu. Standing CI leaves Gates. Done may still name it |
| Trigger | The description says when to use the skill, in one place |
| Thin steps | A numbered procedure gives way to an objective, Goals, and Gates. The agent chooses the path |
| Gates | Done and Impossible can be decided by a product command that exists. The fence is the exact shell string. Exit 0 advances |
| Decouple runtime | Another program's state leaves the required path. A thin ownership file and a real queue take its place. A scheduled loop and a CI-wait leave with it |
| Acceptance sync | Ticket and finding text matches the gates. A command that is gone is deleted |
| Review integrity | Another session writes the verdict, or a command checks kind, revision, ticket, and base, with a nonempty human reason |
| Evidence | The skill names the artifacts, logs, and check results it leaves |
| Self-improve | The four words `NO_CHANGE`, `APPLIED`, `PROPOSED`, `DEFERRED` are present and mean what `optimize` means. Prefer a check, a script, or a gate over another paragraph. `PROPOSED` names hook enforcement only when look-backs show the same gate keeps being ignored. The hook holds the turn until the gate has passed. headsign is one example. Another host's hook is the same proposal |
| De-personalize | Names that belong to one assistant move out of the shared skill |
| Sync | Commands and paths match the checkout. Gate strings match the source exactly |
| Split or merge | A skill that has grown too large, or that both audits and edits, is split. A duplicate is folded in. Only after the user agrees |

Do not propose an abstraction whose only job is to make the skill easier
to test. A direct command the machine can judge is the better change.

## 4. Write the diff

Apply only the items you agreed.

A writable catalog keeps the same id. Update the name, description, and
body you meant to change, and keep the rest of the frontmatter. A
repository file is edited in place. A change that needs a wide
investigation can go through the repository's ordinary change path.

Keep one source. When the edit moves a rule onto a gate, delete the copy
in the reference or the later section.

After Decouple runtime, Acceptance sync, or a gate edit, smoke-test every
command that remains on a gate. A missing dependency is not still required.
A name that appears only in a README is not a gate.

Show the user a summary of the diff. Paste the whole file only when the
summary would hide the change.

## 5. Stop

1. Check that the description, on its own, says when to read the skill.
2. Offer one small way to try it: one gate, or one loop.
3. List the diagnosis items you did not take. Do not continue into them.

Do not write a long retrospective of this meta skill. If the skill you
edited has Self-improve, that section is the one that runs in production.

## Do not

- Rewrite the skill before the diagnosis and the agreed scope.
- Edit an installed plugin or a managed catalog copy.
- Make something no command can judge into a required gate.
- Add a paragraph when a check, a script, or a gate can hold the lesson.
- Leave a required read of another program's state in a skill whose
  purpose is to run on the repository's own commands, or add one as the
  repair.
- Add a scheduled agent loop, a workflow schedule, or a CI-wait as the
  repair.
- Say the acceptance text is synced while a vanished command is still in it.
- Write one assistant's private operations into a shared skill.
- Write access to secrets or production credentials into the skill.
- Add an improvement the user did not choose.
- Propose hook enforcement before look-backs have shown the same gate
  being ignored, or install that hook unless the user agreed.

## Against create-skill-workflow

| | `create-skill-workflow` | `optimize-skill-workflow` |
|---|---|---|
| Input | A repository, or a need for a new skill | A skill that already has a name or a path |
| Result | A new local skill | A diff to that skill |
| Survey | The repository's tools | The text, how it is called, and where it contradicts itself |
| Usual repair | A first version whose gates are shell commands | A required outside runtime, a prose gate, or a stale acceptance command |
| Loops | Invents the skill. Running until Done is not a step there | Removes a scheduled loop or a CI-wait the skill does not need |
