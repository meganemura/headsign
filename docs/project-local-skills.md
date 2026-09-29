# Project-local skills

[日本語](project-local-skills.ja.md)

**Gates live in the skill's `SKILL.md`, as product shell commands the checkout
can run. Exit 0 advances. Ownership and the queue are tools the repository
already has.**

Advance is exit 0 of a fenced shell command in that file. Anything else does
not. The people who follow the skill use the repository's own tools.

Three skills write or revise that file and stop. They do not keep driving
the job the file describes. [`optimize`](../plugin/skills/optimize/SKILL.md)
is a different skill. It assesses a finished run. It does not edit a skill
file.

The file they write defaults to `.agents/skills/<name>/SKILL.md`. When the
repository already documents another directory for contributor skills, the
file goes there. It stays out of a directory the package publishes for
downstream users, unless you have said that directory is the contributor
skill home.

Read the [README](../README.md#project-local-skills) for the short version
of this page. The procedure an agent follows is the skill entry linked under
each heading below. The entry names the one file under `references/` to
open. This page is the account for a person.

## Which skill

| Skill | When to choose it | What you get |
|---|---|---|
| [`create-skill-workflow`](../plugin/skills/create-skill-workflow/SKILL.md) | You are setting a repository up for agent work, or repeated failures should land in a local skill | A new local skill, invented from a survey of commands this checkout can run |
| [`project-skill`](../plugin/skills/project-skill/SKILL.md) | You have named the commands, or pointed at scripts, that should decide the work. A file you name that already holds those command strings is the same job | That skill, with those shell commands as the gates |
| [`optimize-skill-workflow`](../plugin/skills/optimize-skill-workflow/SKILL.md) | A skill already has a name, and something in it is wrong: a gate no command can judge, an acceptance command the checkout cannot run, or a review that is only two roles in one session | A small diff to that skill |

`create-skill-workflow` invents. `project-skill` copies commands that
already exist. `optimize-skill-workflow` revises a skill you name.
`optimize` assesses a finished run. The record's first line is `NO_CHANGE`,
`APPLIED`, `PROPOSED`, or `DEFERRED`. Asking an agent to edit a skill file
is `optimize-skill-workflow`. Asking it to assess a run that already
finished is `optimize`.

[`design-workflow`](../plugin/skills/design-workflow/SKILL.md) designs a
checked procedure. [`workflow`](../plugin/skills/workflow/SKILL.md) walks a
run. They are different skills. The file this page describes stands on the
repository's own commands.

## create-skill-workflow

Use this skill when the local skill has to be invented. Commands you have
already named, or a file you named that holds those command strings, are
the other skill's job, and this one stops and says so.

The agent surveys before it writes. It records commands as the repository
spells them: tests, lint, typecheck, build, an architecture check, a diff or
policy check, an end-to-end or screen check, and property or mutation runs
when the repository has them. It notes prose rules that could become one
command, how big a recent change tends to be, and what agents already have.
It shows you a short inventory.

It asks when a missing answer changes a required outcome or a constraint it
cannot choose. One gap at a time. It answers from the repository before it
asks, and it skips the question when that explanation was the answer. The
gaps it settles are what Done means, whether a structural gate exists, which
paths the job may touch, how independent review is actually produced, when
the skill looks back at itself, and the runtime. The runtime default is the
repository's own commands. A gate does not need another program.

A tool you say is absent stays in the tool menu as a purpose and a
candidate. It is not a gate. The skill writes the file, asks before adding a
one-line pointer in AGENTS.md, names one objective you could try as the
first job, and smoke-tests every command it put on a gate far enough to see
that this checkout can run it. A missing dependency is not left as a
required gate.

The procedure is
[references/procedure.md](../plugin/skills/create-skill-workflow/references/procedure.md).

## project-skill

Use this skill when the gates already exist as shell commands and the job is
to put them in a skill the team can follow.

Lead with the commands you named, or the scripts you pointed at. Each
command is copied into one fence, one command per line, in the order given.
The command is copied as written. A command that contains `&&` or `||` stays
one line. The agent runs that line whole. A lone failing half is not a
failed gate. Every command in the fence must exit 0. The heading names where
an exit 0 goes. A non-zero exit returns to the work above the fence, unless
you named a different return. A budget stated beside a command is one
sentence next to the line. It is not an extra command.

When you name a file, the same rules apply to the shell command strings in
that file. The skill copies those strings. It does not reconstruct the
file's schema, and it does not add a command the file does not contain.

Above the fence, one or two lines name the work that produces what the gate
reads. That work is a description. The gate is the command. Below the fence,
the skill may quote stderr the agent has actually seen, each with the
repair. It reads a checker to learn a message. It does not run a command
that writes, commits, or claims a ticket just to discover the wording, and
it does not invent a message.

The generated skill's gates stay in its `SKILL.md`. The agent that drives
the skill has to see the shell there. After writing, every command appears
once, inside a gate fence.

When the work needs a single owner, **When to use** may say: if a gitignored
file such as `loop.json` shows the job already has an owner, do not start a
second loop. That sentence is not a gate. The gates remain the product
commands.

This skill does not invent checks, does not keep driving the job, and does
not install a program to discover a command.

The rules for a copied gate are
[references/gates.md](../plugin/skills/project-skill/references/gates.md).
The section order is
[references/shape.md](../plugin/skills/project-skill/references/shape.md).

## optimize-skill-workflow

Use this skill when a skill already exists and you want it revised. You name
it, give a path, or point at the one just discussed. The agent finds that
file, reads it, and gives you a short diagnosis. You agree one to three
changes. It applies those and stops. A useful method can stay. Diagnosis
items you did not pick stay listed and untouched.

The diagnosis looks first for a description that never says when to use the
skill, steps so thick the agent cannot choose a tool, a Done that is only
the agent's report, a command or path that disagrees with the checkout, a
checker name that is gone and still sits in Gates or in acceptance text, and
a runtime dependency that contradicts the purpose. The last of those is a
skill that claims to run on the repository's own commands and still requires
another program's state on a gate. It also looks for independent review that
is only two roles in one session, ownership that depends on reading another
program's state, a channel or a person's name baked into a shared skill, a
missing section the local-skill shape requires, and the same policy kept
twice.

The repair for a contradictory runtime takes that state off the required
path. A thin ownership file and a real queue take that place. The repair for
stale acceptance deletes a command that is gone, so ticket text and Gates
name the same live commands. After either repair, every command that remains
on a gate is smoke-tested. A missing dependency is not still required.

An installed plugin or a managed catalog copy is read-only. The change is a
fork into the repository, or into a skill home the host lets you write. The
installed file stays as it was.

The procedure is
[references/procedure.md](../plugin/skills/optimize-skill-workflow/references/procedure.md).

## What the file holds

Both authoring skills write one `SKILL.md`. Gates stay in that file, in this
order:

1. **When to use.** A sentence that refuses a second loop may live here. It
   is not a gate.
2. **Goals.** Three outcomes, and no step list that restates the gates.
3. **Gates.** One heading per advance. The fence is the gate.
4. **Tool menu.** Commands that help produce what a gate reads, and that are
   not themselves gates.
5. **Constraints.** What the agent must not do to force an exit 0, including
   the focus and a pointer at the contract.
6. **Evidence.** Which check results, unmet criteria, and stop reasons
   remain when the job ends.
7. **Self-improve.** A look-back. It is not a shell gate.

**Done** is what is true when the last gate has passed, including a local
commit when a gate requires one. A push is part of Done when you asked for
one. **Impossible** is acceptance that contradicts a preserved contract, or
a gate that can pass only by weakening a check. **Needs human** is missing
authority, missing information, or a check that cannot pass without
inventing work.

The frontmatter `description` says when to use the skill, and that exit 0 of
a command in Gates is the only advance.

### Gates

A gate is a command the checkout can run now. Prefer a product command: the
test suite, the linter, the typecheck, the build, the architecture check the
repository already spells. One fence per advance. Every line in the fence
must exit 0. That is the whole advance model.

The shape, with a stand-in command. The real file uses the repository's
command, copied as the checkout spells it.

````markdown
### Tests pass → review

Make the change the ticket describes. That work is not the gate.

```sh
npm test
```

Exit 0 advances to review. Any other exit returns to this work.
````

A binary that is gone, a subcommand that belonged to a different tool, and a
dependency nobody has installed yet do not appear in Gates. Mutation and
other heavy checks stay off the product gate unless you made them one, and
the skill says when they run. A command that is standing policy, or that CI
runs, but that no gate names, goes in the tool menu, and the skill says it
is not a gate. The same command does not appear again as a second list of
things that must pass.

### Queue

A queue is a CLI that already exists. `bd` is the usual example when that
CLI is installed. An issue-tracker CLI counts. A thin manifest the
repository already has counts. The skill does not reimplement a queue.
When none of these exists, the skill says so, and moving the work is
**Needs human**.

### Ownership

When the work needs a single owner, a gitignored file such as `loop.json` is
enough. The generated skill does not read another program's state to decide
who owns the job. `optimize-skill-workflow` treats a required read of that
state, in a skill that can use a thin file instead, as a defect to repair.

### Acceptance text

The text of a ticket or a finding uses a command that Gates or the tool menu
already names. A checker name the checkout cannot run is removed, including
one that belongs to a tool this checkout does not have. After a revision
that syncs acceptance text, the commands left on a gate are ones this
checkout can run. Leaving a vanished command in the text and calling the
sync done is a failed edit.

### Independent review

A line under Constraints that says the author does not approve their own
change is not a review. The skill requires at least one of these, and may
require more than one. You agree which.

- Another session, or another agent, writes the verdict. Prefer this.
- A command checks the verdict file: kind, revision, ticket, and base. The
  human reason is nonempty markdown. Those checks are required.
- Same-session role play, when it is all that is available, is named as a
  limit under Constraints, and Self-improve watches it.

When the work asks for an independent reviewer, the work line names the
verdict files and says the author of the change does not write the approval.
A rejected, stale, or empty verdict is a non-zero exit back to the producer,
once the checker's own messages say so.

### Self-improve

The local skill ends with a look-back at completion, or after the same gate
fails twice, or both, as you settled. The record's first line is exactly one
of `NO_CHANGE`, `APPLIED`, `PROPOSED`, `DEFERRED`. A nonempty explanation
follows. One pass. These are the same four words
[`optimize`](../plugin/skills/optimize/SKILL.md) uses for a finished run.
Here they record a look at this skill, a check command, or a proposal a
person has to accept. They do not prove the method improved.

`APPLIED` is a change inside the current policy, then how it was verified.
`PROPOSED` is a change that needs a person: AGENTS.md, a contract, CI, or
hook enforcement when look-backs show the same gate keeps being ignored.
The hook holds the turn until the gate has passed. headsign is one example.
Another host's hook is the same proposal. Name the next step. Do not
propose that hook before those look-backs.
`DEFERRED` is a skip, with the reason. The record goes where the repository
already puts this kind of note: a gitignored work log, or a short section in
the change description.

## When gates keep being ignored

The runtime of the local skill is the skill, the product's commands, and a
queue that exists.

When a look-back shows the same gate keeps being ignored, the skill's
self-improve pass can record `PROPOSED` and name hook enforcement that
holds the turn until the gate has passed. headsign is one example. Another
host's hook is the same proposal. The record names the next step. Do not
propose that hook before those look-backs.
[`design-workflow`](../plugin/skills/design-workflow/SKILL.md) and
[`workflow`](../plugin/skills/workflow/SKILL.md) are different skills. Ask
for them when you want them.
[`optimize`](../plugin/skills/optimize/SKILL.md) assesses a finished run. It
does not edit the local skill.

`create-skill-workflow` does not install that hook in the same pass unless
you asked. `optimize-skill-workflow` does not add a required outside runtime
as the repair for a skill whose purpose is to run on the repository's own
commands.

## Use the skills on their own

**Writing the file.** The three skills are instructions. They write or
revise the file and stop. They do not keep driving the job the file
describes.

With the plugin installed, name the skill. Without the plugin, install that
one skill the way the [workflow
reference](workflow-reference.md#using-without-the-plugin) installs
`workflow`:

```
gh skill install meganemura/headsign create-skill-workflow
```

The same command with `project-skill` or `optimize-skill-workflow` installs
that skill. You can also point the agent at the `SKILL.md` linked above and
tell it to follow that entry. It opens one file under `references/` when the
entry names it, writes or revises `.agents/skills/<name>/SKILL.md`, and
stops.

**Following the file.** Later work reads the local skill. The agent does the
work named above a gate, runs the fenced command, and treats exit 0 as the
advance. Node is required only when the product's own commands need it.

A team can keep the local skill in the repository and point every agent at
it. Hook enforcement is a later proposal, recorded when look-backs show a
gate keeps being ignored.
