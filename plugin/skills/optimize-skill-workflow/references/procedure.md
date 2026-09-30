# Revising the skill

## Contents

1. [Find the file](#1-find-the-file)
2. [Read it](#2-read-it)
3. [Choose the change](#3-choose-the-change)
4. [Write the diff](#4-write-the-diff)
5. [Stop](#5-stop)

## 1. Find the file

The user names it, gives a path, or points at the one just discussed.
Search in this order and stop at the first real file. If two remain, ask
once.

| Where it lives | How to find it |
|---|---|
| A shared skill home the host documents as writable | The host's catalog, or a directory listing |
| An installed plugin or a managed catalog | The catalog's absolute path. Read it. Do not edit it |
| The repository | `.agents/skills/<name>/SKILL.md`, or the path the team documents |

An installed or managed copy is forked into the repository or a writable
skill home. Leave the installed file alone.

## 2. Read it

Read `name`, `description`, and the body before changing anything. When
they matter, also read the neighboring references, the callers, and the
commands the acceptance text names.

**Why and env, one source.** The `description` is the only when-to-use.
The checkout's spelling is the only gate string. A second copy of either
is the defect.

For a project-local skill, **Done** (contract) is human-ready: local gates
exited 0, CI green, and AI review complete. **Steps** are not that
contract. A CI-wait or a review-comment loop in the procedure is a defect.
Gates are shell fences in `SKILL.md`.

Give the user three to seven levers from the table that actually apply.

## 3. Choose the change

Agree one to three levers. When several fit, prefer a check, a script, or
a gate. Explore the checkout before you ask, and bring a recommended
default. A useful method can stay.

| Lever | What changes |
|---|---|
| Structuralize | A repeated prose rule becomes a check, a script, or a gate. The prose copy is deleted |
| Classify | A local exit-0 command stays a gate. A helper moves to the tool menu. Standing CI leaves Gates |
| Why | The description says when. A body that restates it is deleted |
| Thin steps | A numbered procedure gives way to an objective, Goals, and Gates |
| Gates | The fence is the checkout's exact shell string, in `SKILL.md`. Exit 0 advances. A prose checklist titled Gate is not one |
| Decouple runtime | Another program's state, a scheduled loop, or a CI-wait leaves the required path. A thin ownership file such as `loop.json` and a real queue take that place when one is needed |
| Acceptance sync | Ticket text names the same live commands as Gates. A command that is gone is deleted |
| Review integrity | Another session writes the verdict, or a command checks kind, revision, ticket, and base, with a nonempty human reason |
| Evidence | The skill names the artifacts and check results it leaves |
| Self-improve | The four words `NO_CHANGE`, `APPLIED`, `PROPOSED`, `DEFERRED` mean what `optimize` means. A check or a script is preferred over another paragraph. `PROPOSED` names hook enforcement only after look-backs show the same gate keeps being ignored |
| De-personalize | Names that belong to one assistant move out of the shared skill |
| Env | Gate strings match the checkout, or the file the user named, exactly. A paraphrase is deleted |
| Split or merge | A skill that has grown too large, or that both audits and edits, is split. A duplicate is folded in. Only after the user agrees |

Do not add an abstraction whose only job is to make the skill easier to
test.

## 4. Write the diff

Apply only the agreed levers.

A writable catalog keeps the same id. A repository file is edited in
place. Do not write access to secrets or production credentials. Do not
install a hook unless the user agreed.

After a gate edit, smoke-test every command that remains on a gate. A
missing dependency is not still required. A README name is not a gate.

Show a summary of the diff. Paste the whole file only when the summary
would hide the change.

## 5. Stop

1. The description, on its own, says when to read the skill.
2. Offer one small way to try it: one gate, or one loop.
3. List the levers you did not take.

Do not write a retrospective of this procedure. If the skill you edited
has Self-improve, that section is the one that runs in production.

| | `create-skill-workflow` | this skill |
|---|---|---|
| Input | A repository that still needs a skill | A skill that already has a name or a path |
| Result | A new local skill | A diff |
| Loops | Running until Done is not an invent step | A scheduled loop or a CI-wait comes out |
