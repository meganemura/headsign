# ADR-0033: The one variable headsign sets

- Status: accepted
- Date: 2026-08-25
- Amends [ADR-0014](0014-removing-three-unused-knobs.md) §1: its removal of the
  per-phase `env:` let `gate.ts` say that every command headsign runs inherits
  headsign's own environment unmodified. One variable is now added to that
  environment, and this says which one and why it is not the knob that was
  removed.

## Context

A workflow can be written by one person and finished by another. A tool ships a
workflow with blanks in it, somebody fills them in, and a gate checks that they
did. That gate has to read the workflow file, because the blanks are in the
workflow file and nowhere else.

There is no way for it to find that file. The three places `gate.ts` runs a
shell command — a gate's checks, a phase's `ready:` probe, and an `on_pass`
route's `when:` — pass no environment of their own, so a check sees whatever
headsign was started with and nothing about the run. The path is on disk, in
`state.json`'s `workflow_path`, which [ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md)
puts outside the public surface. `status` prints `workflow:`, which is the
`name` from the YAML rather than the path to it.

So a check that needs the path writes it in by hand. That works until the file
is renamed — and the name is not the check author's to keep still. `headsign
start <name>` resolves `.headsign/<name>.yaml`, so whoever starts the run picks
the name, which may be long after the checks were written.

## Decision

**1. `HEADSIGN_WORKFLOW_FILE` is set in the environment of every command
`gate.ts` runs.** A gate's checks, a phase's `ready:` probe, and an `on_pass`
route's `when:` all get it. A variable present at one of those and absent at
another would be a trap: all three are the workflow asking a question about the
tree, and an author has no reason to expect them to differ.

**2. Its value is the path headsign recorded for this run, verbatim.** The same
string `state.json` holds, and the one `validate` falls back to when no file is
named on its command line — relative when the run was started by name, absolute
when it was started with an absolute `--workflow`. (`.headsign/log` does not
carry it: the only workflow it names is the `name` from the YAML, on the start
line.) It is not normalised to an absolute path, because that would make
two spellings of one path and a reader would have to know which they were
holding. Commands run in the run's directory (ADR-0004's cwd-only resolution),
which is what makes the recorded path usable as it stands.

**3. This is not the knob ADR-0014 removed.** That ADR took away a per-phase
`env:` mapping, and the reason was that the shell already spells it: `run:
"FOO=bar npm test"` says the same thing in one line, next to the command it
applies to. **That replacement does not exist here.** An author can of course
type a path into their own `run:` string — that is what they do today — but they
cannot know at authoring time which path will be right, because it is not
decided until the run starts, by somebody who may not be them.

**4. The line: headsign supplies what only headsign resolved, and what the
author could not have written down at authoring time.** The workflow path passes
both tests. A phase's name does not — it sits in the same file, a few lines from
the check. The attempt count does not either, and that one is refused rather
than merely unnecessary: a gate that reads it has stopped being a question about
the tree and started being a question about the run, which is the distinction
[ADR-0020](0020-writing-the-workflow-as-its-own-skill.md) calls unfakeable —
"reads the tree and git alone, leaning on nothing this run produced".

**5. A variable of that name already in the environment is replaced.** headsign
sets it last, so a check reads the run's own path whatever the surrounding
session exported — including a `headsign` invoked from inside a check, whose own
value would otherwise leak into the nested run's.

## What is deliberately not being done

**Bringing back `env:`.** ADR-0014 §1 stands. An author who wants a variable for
their own command still writes it in the command.

**A second variable, for anything.** Each one would have to pass decision 4's
two tests on its own, and the point of writing the line down is that the next
one is argued rather than assumed.

**Normalising the path, or resolving it against anything.** headsign passes what
it recorded. A check that changes directory before reading it is outside
ADR-0004's cwd rule already, and inventing an absolute form for that case would
cost every other check a second spelling to think about.

## Consequences

The commands `gate.ts` runs no longer get headsign's environment unmodified, and
its header says so — `gate.ts` itself inherits exactly what it always did.
The three functions take the path as an argument: `engine.ts` has it on the run
record and passes it down, and neither module looks inside the environment at
all.

What changes about `cli.ts`'s standing is smaller than it first looks, and
smaller than the first draft of this paragraph said. `cli.ts` was described as
the only file that reads the process environment; that was on the wrong axis
even before this change, because `cli.ts` reads no value out of it — it hands
the whole map down, and the values are read in `stophook.ts`, out of an
argument. The axis the rule is true on is **reaching for `process.env`**, which
`cli.ts` does so that nothing below has to. `gate.ts` now reaches for it too, and
only to copy it into a child that never gets inspected.

This rule is written in `gate.ts`'s header, `architecture.md`'s `cli.ts` row, a
comment each in `engine.ts` and `cli.ts`, and here — five places, which is four
more than one wants for a sentence this easy to state slightly differently. A
reader correcting it should expect to find every one of them. A grep turns up
one more, in `.headsign/notes/comment-sweep.md`: that file records what a sweep
found on the day it ran, so it keeps the wording of its own date and is not a
sixth place to correct.

A workflow may now be written to check itself, which is the shape this record
exists for: wherever a tool distributes a workflow for somebody else to
complete, the gate that verifies the completion can read the file it is running
under, whatever that file ended up being called.

A check that already hardcodes its own path keeps working. Nothing is removed
and nothing is renamed.
