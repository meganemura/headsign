# Inventing the local skill

Write `.agents/skills/<name>/SKILL.md`, unless the repository already
documents another directory for contributor skills. Do not write into a
directory the package publishes for downstream users unless the user says
that directory is the contributor skill home.

Named commands, or a file of those command strings: stop and use
`project-skill`.

Done, Steps, Gates, and the completion criterion for each phase are in
the entry. This file is the work inside the phase. An unattended loop the
user wants is a `PROPOSED` line in Self-improve.

**Why and env, one source.** The generated `description` is the only
when-to-use. The checkout's own spelling is the only gate string. Do not
copy either into a second section.

## Contents

1. [Survey](#1-survey)
2. [Settle](#2-settle)
3. [The file](#3-the-file)
4. [Write](#4-write)
5. [Check](#5-check)

Section 3 is the spec Write applies. It is not a fifth phase.

## 1. Survey

Read first. Record commands as the repository spells them. Do not write
the skill in this step.

Mechanical signals are whatever exits 0 or not: tests, lint, typecheck,
build, an architecture check, a diff or policy check, an end-to-end or
screen check, and property or mutation runs when the repository has them.

Tag each command.

- A **gate candidate** is a command this checkout can run. Exit 0 would
  advance.
- A **tool** helps produce what a gate reads.
- **Standing CI** belongs in the Done contract when it must be green. It
  is not a local gate and not a step here.

Name a queue only when it exists: `bd`, an issue-tracker CLI, or a thin
manifest. Otherwise moving the work is Needs human. Note prose that could
become one command, how big a recent change tends to be, and what agents
already have, including whether CI and an AI review exist.

Show the user a short inventory, then go on.

## 2. Settle

Read the repository before you ask. When you ask, offer one recommended
default from that evidence and what it costs. One gap at a time. If the
evidence answered it, do not ask.

- **Done.** The entry's contract. Ask only when the survey contradicts it.
- **Contract.** Whether a structural gate exists, and how far it reaches.
- **Focus.** Paths the job may touch, and where "not this" is written.
- **Review.** How independence is produced. Another session or agent is
  the default. Same-session role play is a limit, not a review.
- **Self-improve.** At completion, after the same gate fails twice, or
  both.
- **Runtime.** The repository's own commands. A missing tool stays a
  named candidate in the tool menu.

## 3. The file

Use this order. A rule that sits on a gate is not repeated below it.
Standing policy stays in AGENTS.md when that file exists; the skill
points at it.

A gate command is one this checkout can run. Resolve it before Write. A
name that appears only in a README is not enough. A vanished binary, a
foreign subcommand, or an uninstalled dependency is not a gate and not
acceptance text. Do not write access to secrets or production credentials.

Ownership, when the work needs one owner, is a gitignored file such as
`loop.json`. The skill does not read another program's state.

1. **When to use.** The `description` already says this. The body only
   adds a fact the description cannot hold, such as: if `loop.json` shows
   an owner, do not start a second loop. That sentence is not a gate.
2. **Goals.** Done is the entry's contract. Impossible: acceptance
   contradicts a preserved contract, or a gate can pass only by weakening
   a check. Needs human: missing authority or information, a check that
   cannot pass without inventing work, or standing CI the survey did not
   find. No step list.
3. **Gates.** One fenced shell command per advance, the checkout's
   spelling, in this file. Above it, the work that produces what the gate
   reads. That work is not a gate.
4. **Tool menu.** One command, path, or candidate per purpose, from the
   survey. Do not repeat a gate command.
5. **Constraints.** What the agent must not do to force an exit 0,
   including the focus. Two to five out-of-scope bullets, each pointing
   at where that work belongs.
6. **Evidence.** Check results, unmet criteria, and stop reasons that
   remain. Acceptance text for a ticket uses a command Gates or the tool
   menu already names.
7. **Self-improve.** One pass at the look-back you settled. The record's
   first line is exactly one of `NO_CHANGE`, `APPLIED`, `PROPOSED`,
   `DEFERRED`. Prefer a check, a script, or a gate (`APPLIED`) over a
   longer paragraph. AGENTS.md, a contract, CI, or a host hook is
   `PROPOSED`. One chat's anecdote is `NO_CHANGE` or `DEFERRED`. When
   look-backs show the same gate keeps being ignored, `PROPOSED` may name
   hook enforcement that holds the turn until the gate has passed.
   headsign is one example. Another host's hook is the same proposal.
   Name the next step. Do not install that hook in this pass unless the
   user asked. The record is a self-report. Put it where the repository
   already puts this kind of note.

Independent review, when the work needs one. A Constraints sentence is
not a review. Agree at least one of these:

- Another session or agent writes the verdict.
- A command checks the verdict file: kind, revision, ticket, and base,
  and a nonempty human reason. That command can be a gate. Copy it exactly.
- Same-session role play, if it is all that is available, is named as a
  limit, and Self-improve watches it.

Optional in the file: a pointer at the CI checks the Done contract names,
and a pointer at a risk table. The pointer is not a gate.

Tool menu purposes, none of them mandatory:

| Purpose | What to look for |
|---|---|
| Prove acceptance | Tests, an end-to-end check, a contract test |
| See a weak property | Property tests, mutation, kept off the product gate |
| Hold the structure | An architecture check, a package boundary |
| Hold the focus | A diff allowlist |
| Repair from the failure | A diagnostic that names a line or a rule id |
| Move the queue | A real ticket CLI, such as `bd` |
| Improve the outside | A check command, AGENTS, or this skill |

## 4. Write

Apply section 3. Ask before adding a one-line pointer in AGENTS.md. Name
one objective the user could try as the first job.

## 5. Check

Smoke-test every gate command far enough to see this checkout can run it.
A missing dependency is not a required gate. Do not write a retrospective
of this procedure.
