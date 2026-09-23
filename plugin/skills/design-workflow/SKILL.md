---
name: design-workflow
license: MIT
description: >-
  Design and write a headsign workflow file — the YAML that names a
  repository's phases and holds the shell checks that gate them. Use when the
  user asks to create a workflow for this repository, to add another one
  alongside ones already there, or to change how an existing one's phases,
  gates, routes, or limits are shaped. This skill authors the file and stops
  at it; starting, continuing, or resuming a run is the `workflow` skill's
  job instead. The two divide by what is being asked for — writing the graph
  versus walking it — not by what is on disk, so this one applies whether or
  not the repository already has a .headsign/ directory.
---

# Designing a headsign workflow

A headsign workflow is one YAML file, committed to the repository. It names
the phases of a job and, for each phase, the shell commands whose exit codes
decide whether the work may leave it. This skill works out what those phases
and those commands should be **for this repository**, uses the user's objective
and constraints to choose the shape, and writes the file.

This file is the entry. It says when the skill applies, the constraints, and
which reference to open. Open the one reference the situation names. Do not
load `references/` up front.

When this skill runs inside the headsign plugin in Claude Code or Codex, the
CLI is bundled with it and no install is needed. In Claude Code,
`headsign <cmd>` below means:

```
node "${CLAUDE_SKILL_DIR}/../../dist/headsign.mjs" <cmd>
```

In Codex, use the absolute SKILL.md path that Codex supplies for this skill.
Go up from `skills/design-workflow/SKILL.md` to the plugin root, then invoke
`dist/headsign.mjs` with Node. Do not assume a session environment variable
for the skill directory; the Codex contracts checked for this release did not
confirm one.

(A PATH-installed `headsign` works too, and so does `npx headsign` once the
package is installed. Check which you have before reaching for either —
`command -v headsign` names a PATH copy if one exists. **`npx headsign` with
nothing installed does not fail; it installs from the registry**, at a version
npm chooses rather than the one this plugin ships, and that copy will read and
write the same `.headsign/state.json` the bundled one has been driving.)

If the bundled path above does not exist, this file is a copy running
outside its plugin (for example, in `.claude/skills/` or `.agents/skills/`) — the bundle only
ships with the plugin. Use a PATH-installed `headsign`, or `npx headsign`
on the terms above; otherwise stop and tell the user to either install the
plugin or `npm install` the package. Do not guess at other paths.

When the user selects a local checkout, use its supplied bundle path and read
its current skills. An installed plugin is a cached copy; a source edit alone
does not update that copy. Keep an existing run when switching CLI copies.
Do not abort, restart, or edit its state just to enable optimization.

## What this skill does not do

1. **It is not itself driven as a headsign run.** Do not `headsign start`
   anything in order to write a workflow. This is the machinery for *making*
   workflows; it does not need to be one.
2. **It never runs `headsign start` on its own judgment.** `start` does not
   just name a phase — it prints that phase's instructions, and an agent's
   discipline is to obey them, so the user's actual work begins the moment
   you call it. Someone who asked for a workflow to be written did not ask
   for the work in it to begin, least of all from a file that has never run.
   Finish at the file plus the one line that would start it. If the user asks
   you to write it *and* run it, that is a second request, and from there the
   `workflow` skill takes over.
3. **It never deletes or renames a workflow file.** Revision here means the
   contents of a file. A rename is not a design change, and it is the
   shortest path to breaking a run: a run goes looking for the exact path it
   recorded at `start`.
4. **It does not build the checks a repository is missing.** If there is
   nothing here a shell command can judge, name what is missing and stop.
   Adding tests, a linter, or a build to someone's repository is a different
   job, and taking it turns this into a tool that no longer writes workflows.
5. **It does not send anyone to `docs/workflow-reference.md`.** That file
   ships in neither the plugin nor the npm package, so it is not on the
   user's disk. Everything you need is this file and `references/` next to
   it. For the same reason, do not point at `example.headsign/` either.
6. **It does not have to match the paste-in prompt in headsign's README.**
   They are independent documents, maintained separately. The order between
   them is only this: this skill is the procedure for someone who has adopted
   headsign, and the README's prompt is that procedure adjusted for someone
   who has not yet. If a user arrives holding that prompt's output, take it
   (step 1) — but do not treat its wording as a specification for yours.

## Design for revision

Assume later models can improve this method. Keep required outcomes and useful
checks explicit, and preserve the reasons and concrete cases that justify them.
Prefer a consequential improvement over an easy nearby edit. A valid design
can also retain a useful method or propose a larger change for later work.

New runs already prompt a terminal assessment through the `optimize` skill.
Add a dedicated retrospective phase only when the work needs its own artifacts
or transition checks. When a workflow already has one, reuse its findings;
optimization need not repeat the same investigation.

Repair a demonstrated mismatch at its source. Read the producer instruction,
the gate that consumes its artifact, and the artifact's lifetime together.
Use the same path on both sides and keep it until its last consumer finishes.
Required evidence may be a validation result without a code edit. A veto or
rejection needs a defined route that preserves its reason and permits rework.

For a review gate, establish the current final decision and the revision it
covers. Test a rejection, an absent verdict, and a changed revision as well as
approval. A gate that checks only report size cannot make those distinctions.
Keep historical review text separate from the current decision used by a gate.

For revisions, compare the requested outcomes and constraints before and after
the change. Existing task authority can cover reversible structural repairs.
Changes to outcomes, explicit budgets, access, or external actions need the
relevant authority. A graph fingerprint does not establish that authority:
descriptions and external check scripts can change requirements too.

During a live run, preserve its recorded path and current phase. Let the
`workflow` driver handle any reported change through a separate
`next --accept-graph-change` call. Authoring the file does not accept that change.

## Asking

Use the user's decisions and delegated authority. Ask only when a missing
answer affects a required outcome or a constraint you cannot choose. One
question at a time. Answer it yourself from the repository and the log before
asking; if that explanation produced the answer, do not ask. Bring the
candidates and what each one costs. Do not invent required authority. When a
required answer is unavailable, finish the independent work and mark the
dependent decision unconfirmed.

Before you ask, open `references/asking.md`.

## The procedure

The steps are a circuit, not a march. A `max_attempts` and a `timeout:` often
need a second visit after a command runs for the first time. Open
`references/procedure.md` and follow it. It names the other references at the
step that needs them.

1. **Find out what this repository can prove.** Inventory commands, prose
   rules, history, and artifacts. Sort every check as unfakeable, anchored,
   or fakeable, and guard every anchor. Refuse only after looking in all
   three places.
2. **Work out the unit of work, and split it into phases.** New file: read
   recent changes. Revision: read the file and `.headsign/log`. Size phases
   to what a gate can check.
3. **Draw the shape** in ASCII, including a straight line when the work does
   not branch. That picture becomes the header comment.
4. **Choose the numbers.** Ceiling, `max_attempts`, and `timeout:` fail in
   different ways. Never invent a timeout.
5. **Choose the names, and check the path is free.** `headsign status` first.
   Exit 3 with no `.headsign/` yet means there is no run, which is the
   expected answer for a first workflow.
6. **Write** `.headsign/<name>.yaml`. Vocabulary: `references/vocabulary.md`.
   A field or branch the example does not cover: `references/schema.md`.
   Comments: `references/comments.md`.
7. **Verify.** `headsign validate --workflow <path>` is necessary and not
   sufficient. Check repository commands by existence; run composed commands
   once. Try the failing path when you can do it reversibly.
8. **Hand it over, and stop.** Name the three tiers, then stop. Do not start
   the run. Before the report, read `references/pitfalls.md`.

## Which reference

| Situation | Open |
|---|---|
| Carrying out the design, from the survey through the hand-over | `references/procedure.md` |
| About to ask the user a design question | `references/asking.md` |
| Writing the YAML of a simple workflow | `references/vocabulary.md` |
| A field, a branch, or a `validate` rejection the example does not explain | `references/schema.md` |
| A file that validates and can still misbehave, including before the hand-over | `references/pitfalls.md` |
| Pairing a check with its instruction, a claim that lives in prose, how much gate is enough, or a round with nothing for a phase | `references/checks.md` |
| Writing the file's comments | `references/comments.md` |

Driving a run is the `workflow` skill. Assessing a finished run is the
`optimize` skill.
