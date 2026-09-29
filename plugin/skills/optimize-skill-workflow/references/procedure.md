# Revising the skill

The entry states the seam with `optimize`. This file is the pass from a
named skill to a small diff.

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

Give the user a short diagnosis, three to seven points. Look for these
first:

- The description does not say when to use the skill.
- The steps are thick, and the agent cannot choose a tool.
- Done is the agent's report, and no command can disagree.
- A command or a path disagrees with the checkout, or a checker name that
  is gone remains in Gates or in acceptance text.
- A runtime dependency contradicts the purpose. A skill that claims to
  run without headsign still requires `.headsign/` or a dedicated
  orchestrator on a gate.
- Independent review is only two roles in one session, and no command
  checks the verdict.
- Ownership depends on reading an orchestrator's state, where a thin
  gitignored file such as `loop.json` would do.
- A channel, a repository, or a person's name that belongs to one
  assistant is baked into a shared skill.
- A local workflow skill is missing a section `create-skill-workflow`
  requires: Goals, Gates, Tool menu, Evidence, or Self-improve.
- The same policy is also kept in AGENTS.md or in another skill.

## 3. Choose the change

Do not fix the whole list. Agree with the user which one to three items
happen now.

Use a lever only when the diagnosis named it:

| Lever | What changes |
|---|---|
| Trigger | The description says when to use the skill |
| Thin steps | Line-by-line procedure gives way to an objective and a choice of tools |
| Gates | Done and Impossible can be decided by a product command that exists |
| Decouple runtime | An orchestrator or headsign state leaves the required path. A thin ownership file and a real queue take its place |
| Acceptance sync | Ticket and finding text matches the gates. A command that is gone is deleted |
| Review integrity | Another session writes the verdict, or a command checks kind, revision, ticket, and base, with a nonempty human reason |
| Evidence | The skill names the artifacts, logs, and check results it leaves |
| Self-improve | The four words `NO_CHANGE`, `APPLIED`, `PROPOSED`, `DEFERRED` are present and mean what `optimize` means |
| De-personalize | Names that belong to one assistant move out of the shared skill |
| Sync | Commands and paths match the checkout |
| Split or merge | A skill that has grown too large is split, or a duplicate is folded in, only after the user agrees |

Do not propose an abstraction whose only job is to make the skill easier
to test. A direct command the machine can judge is the better change.

## 4. Write the diff

Apply only the items you agreed.

A writable catalog keeps the same id. Update the name, description, and
body you meant to change, and keep the rest of the frontmatter. A
repository file is edited in place. A change that needs a wide
investigation can go through the repository's ordinary change path.

After Decouple runtime or Acceptance sync, smoke-test every command that
remains on a gate. A missing dependency is not still required.

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
- Leave a required headsign or orchestrator read in a skill whose purpose
  is to run without one, or add one as the repair.
- Say the acceptance text is synced while a vanished command is still in it.
- Write one assistant's private operations into a shared skill.
- Write access to secrets or production credentials into the skill.
- Add an improvement the user did not choose.

## Against create-skill-workflow

| | `create-skill-workflow` | `optimize-skill-workflow` |
|---|---|---|
| Input | A repository, or a need for a new skill | A skill that already has a name or a path |
| Result | A new local skill | A diff to that skill |
| Survey | The repository's tools | The text, how it is called, and where it contradicts itself |
| Usual repair | A first version that finishes without headsign | A required orchestrator, or a stale acceptance command, that arrived later |
