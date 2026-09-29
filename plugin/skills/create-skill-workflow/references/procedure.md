# Inventing the local skill

The entry states the seam. This file is the pass from survey to the file.

The local skill lives at `.agents/skills/<name>/SKILL.md` unless the
repository already documents another directory for contributor skills. Do
not write it into a directory the package publishes for downstream users
unless the user says that directory is the contributor skill home.

If the job is only to copy commands the user named, or command strings from
a file they named, stop and use `project-skill`.

## 1. Survey

Read first. Do not write the skill in this step. Record commands as the
repository actually spells them.

Mechanical signals are whatever exits 0 or not: tests, lint, typecheck,
build, an architecture check, a diff or policy check, an end-to-end or
screen check, and property or mutation runs when the repository has them.

Name a queue only when it exists: `bd`, an issue-tracker CLI, or a thin
manifest in the repository. Do not reimplement one. If none exists, say so
and treat the queue as a Needs human candidate.

Note prose rules (AGENTS.md, CONTRIBUTING, comments) that could become one
command. Note how big a recent change tends to be. Note what agents already
have: AGENTS.md, skills, and required CI checks.

Show the user a short inventory, then go on.

## 2. Settle what is missing

Ask when a missing answer changes a required outcome or a constraint you
cannot choose. One gap at a time, the important one first. Answer it from
the repository before you ask. If that explanation produced the answer, do
not ask.

Settle at least these:

- **Done.** How acceptance is checked, and how a failure is visible.
- **Contract.** Whether a structural gate exists, and how far it reaches.
- **Focus.** Paths the job may touch, and where "not this" is written
  (per job, or standing).
- **Human on the loop.** When review depth matters, how independence is
  actually produced. Playing both roles in one session is not enough on
  its own.
- **Self-improve.** When the local skill looks back: at completion, after
  the same gate fails twice, or both.
- **Runtime.** The default is the repository's own commands. A gate does
  not need another program.

A tool the user says is absent stays in the tool menu as a purpose and a
candidate. It is not a gate. A later self-improve pass can promote it.

## 3. What the local skill owes the agent

Keep the procedure thin. Do not force a sequence of stages that no command
can judge. Hand over the objective and the tools. Leave the path to the
agent.

Done is a command's result wherever that is possible, not the agent's
report that it is done. "Do not" is the definition of focus, not a second
procedure. Standing policy belongs in AGENTS.md when that file exists; the
skill points at it and carries the tools for the job.

A gate command is one the checkout can run now. A binary that is gone, a
subcommand that belonged to a different tool, and a dependency nobody has
installed yet do not appear in Gates or in acceptance text.

When the work needs a single owner, a gitignored file such as `loop.json`
is enough. Do not send the generated skill to read another program's state.

A queue is the CLI that exists. `bd` is the usual example when that CLI is
installed. Where it is not, the outcome is Needs human.

## 4. Sections the local skill carries

Use this order. Gates stay in `SKILL.md`, not in a reference the driver
might skip. Each gate is a shell command in that body. Exit 0 advances.

1. **When to use.** A sentence that refuses a second loop may live here.
   It is not a gate. When ownership matters, a thin gitignored file such as
   `loop.json` is the record. If it shows the job already has an owner, do
   not start a second loop.
2. **Goals.** Done, Impossible, and Needs human. No step list that
   restates the gates. Impossible covers acceptance that contradicts a
   preserved contract, or a gate that can pass only by weakening a check.
   Needs human covers missing authority, missing information, or a check
   that cannot pass without inventing work.
3. **Gates.** Advance is exit 0 of a fenced shell command. Prefer a
   product command. One fence per advance. Above it, the work that
   produces what the gate reads. That work is not a gate.
4. **Tool menu.** A tool for each purpose: the command, the path, or a
   candidate that is not installed yet. Do not repeat a gate command here.
5. **Constraints.** What the agent must not do to force an exit 0,
   including the focus and a pointer at the contract.
6. **Evidence.** Which check results, unmet criteria, and stop reasons
   remain when the job ends.
7. **Self-improve.** Below.

Optional: the CI gate list, a pointer at a risk table, and the condition
for proposing hook enforcement (the same gate keeps being ignored).

Acceptance text for a ticket or a finding uses a command that Gates or the
tool menu already names. Remove a checker name the checkout cannot run,
including one that belongs to a tool this checkout does not have. Keep
mutation and other heavy checks off the product gate unless the user made
them one, and say when they run.

## 5. Independent review

Writing "the author does not approve their own change" under Constraints
is not a review. Agree with the user which of these the local skill will
require. More than one is allowed.

- Another session or another agent writes the verdict. Prefer this.
- A command checks the verdict file: kind, revision, ticket, and base.
  The human reason is nonempty markdown. Those checks are required, not
  optional color.
- Same-session role play, if it is all that is available, is named as a
  limit under Constraints, and Self-improve watches it.

## 6. Tool menu

Fill the menu from the survey. Mark anything that is not installed as a
candidate. Nothing in this table is mandatory.

| Purpose | What to look for |
|---|---|
| Prove acceptance | The product's tests, an end-to-end check, a contract test |
| See a weak property | Property tests, mutation, kept off the product gate |
| Hold the structure | An architecture check, a package boundary |
| Hold the focus | A diff allowlist |
| Repair from the failure | A diagnostic that names a line or a rule id |
| Move the queue | A real ticket CLI, such as `bd` |
| Improve the outside | Self-improve on this skill, AGENTS, or a check command |

## 7. Self-improve

The local skill ends with a look-back at completion or at a terminal stop.
The record's first line is exactly one of `NO_CHANGE`, `APPLIED`,
`PROPOSED`, `DEFERRED`, the same four words the `optimize` skill uses.
A nonempty explanation follows. One pass.

- `NO_CHANGE` — leave it, and say why.
- `APPLIED` — a change inside the current policy: this skill, a check
  command, or a thin helper, then how it was verified.
- `PROPOSED` — a change that needs a person: AGENTS.md, a contract, CI,
  or hook enforcement when look-backs show the same gate keeps being
  ignored. The hook holds the turn until the gate has passed. headsign is
  one example. Another host's hook is the same proposal. Name the next step.
- `DEFERRED` — skipped, and why.

Prefer a change that makes a later job's completion, its failure signal,
or its focus easier to judge. A longer explanation is not the goal. The
record is a self-report. It does not prove the method improved.

Put the record where the repository already puts this kind of note: a
gitignored work log, or a short section in the change description.

## 8. Write it and check it

1. Write the file at the path you confirmed.
2. Ask before adding a one-line pointer in AGENTS.md. Do not keep the
   same standing policy in both places.
3. Name one objective the user could try as the first job.
4. Smoke-test every command you put on a gate. Resolve it far enough to
   see that this checkout can run it. A missing dependency is not a
   required gate.
5. Do not write a retrospective of this meta skill. The local skill's
   Self-improve section is the one that runs in production.

## Do not

- Put another program's state on a gate in the file you write.
- Choose a large procedure before the survey.
- Fix the agent's steps line by line.
- Make something no command can judge into a required gate.
- Leave a vanished command in Gates or in acceptance text.
- Write access to secrets or production credentials into the skill.
- Propose hook enforcement before look-backs have shown the same gate
  being ignored.
- Install that hook in this pass unless the user asked.

## When gates keep being ignored

The artifact of this skill is the local skill. The runtime is the skill,
the product's commands, and a queue that exists.

When a later look-back shows the same gate keeps being ignored, the local
skill's self-improve pass may record `PROPOSED` and name hook enforcement
that holds the turn until the gate has passed. headsign is one example.
Another host's hook is the same proposal. Name the next step. Do not
install that hook in this pass unless the user asked. `design-workflow`
and `workflow` are different skills. Ask for them when you want them.
