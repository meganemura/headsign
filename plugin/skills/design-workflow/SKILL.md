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
and those commands should be **for this repository**, settles the shape with
the person who asked, and writes the file.

When this skill runs inside its Claude Code plugin, the CLI is bundled with
it and no install is needed. `headsign <cmd>` below means:

```
node "${CLAUDE_SKILL_DIR}/../../dist/headsign.mjs" <cmd>
```

(A PATH-installed `headsign` works too, and so does `npx headsign` once the
package is installed. Check which you have before reaching for either —
`command -v headsign` names a PATH copy if one exists. **`npx headsign` with
nothing installed does not fail; it installs from the registry**, at a version
npm chooses rather than the one this plugin ships, and that copy will read and
write the same `.headsign/state.json` the bundled one has been driving.)

If the bundled path above does not exist, this file is a copy running
outside its plugin (e.g. placed in `.claude/skills/`) — the bundle only
ships with the plugin. Use a PATH-installed `headsign`, or `npx headsign`
on the terms above; otherwise stop and tell the user to either install the
plugin or `npm install` the package. Do not guess at other paths.

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
   user's disk. Everything you need is below; the rest is in
   `references/schema.md`, next to this file. For the same reason, do not
   point at `example.headsign/` either.
6. **It does not have to match the paste-in prompt in headsign's README.**
   They are independent documents, maintained separately. The order between
   them is only this: this skill is the procedure for someone who has adopted
   headsign, and the README's prompt is that procedure adjusted for someone
   who has not yet. If a user arrives holding that prompt's output, take it
   (step 1) — but do not treat its wording as a specification for yours.

## Asking well

You write the file, but you do not decide the shape of someone else's work
alone. The manner is the one this repository's own design workflow uses:

- **One question at a time.** A batch of questions gets a batch of shallow
  answers.
- **Before asking, try to answer it yourself, plainly.** Read the repository,
  read the run history if there is one, and write out what you think the
  answer is and what it costs. Most questions worth asking answer themselves
  on the way to being said plainly.
- **If the explanation produced the answer, do not ask.** The point of
  explaining first is to make the question unnecessary, not to preface it.
- **When you do ask, bring the candidates and what each one costs.** "How
  many attempts should implement get?" is work handed back to the user.
  "I put 5 here because implementation legitimately takes several passes;
  3 would surface a stuck loop sooner but ends the run earlier" is a
  question they can answer in one line.
- **Do not guess an answer to keep moving.** Ask, and wait for the answer.
- **Keep the answers where they survive.** A decision that explains why the
  file has the shape it has belongs in the file's comments (see *What goes
  in the comments*); the rest belongs in what you report at the end. The
  conversation does not survive; the file does.

**When no answer is coming, waiting still comes first — but there is a way to
stop that is not a guess.** Sometimes there is nobody at the other end: the
person who asked has stepped away, or this is running unattended inside
something larger. Waiting remains the default and you exhaust it before
concluding anything else. What that situation does not license is inventing
the answer and settling it. What it also does not license is going quiet and
leaving nothing behind. Write everything the missing answer does not block,
then hand over — with the question as you would have asked it, the candidates
and their costs, and your own recommendation with its reason. **Put the fact
that it is unconfirmed where the person cannot miss it**: at the top of what
you report, and in a comment on the line it affects. The failure this guards
against is a workflow received as settled when one of its numbers was never
agreed by anyone.

## The procedure

**The steps are a circuit, not a march.** They are numbered because each one
usually needs the one before it, but the traffic runs both ways, and two
places in particular are meant to be revisited: a phase's `max_attempts`
cannot be reasoned about until you know what its gate actually contains, and
a `timeout:` often cannot be measured until step 7 runs the command for the
first time. Drafting the file and coming back to step 4 with real numbers is
the normal path, not a sign of having gone about it wrongly. What must not
happen is a number that never gets its second visit.

### 1. Find out what this repository can prove

The `run:` of every gate is a command that has to exist here, so nothing can
be written before this step. **Start here even if the user has already
described the loop they want in words.**

**If the user brings an inventory of signals** — the output of the README's
paste-in prompt, or their own list of commands — read it and go on to step 2,
after confirming those commands still exist (step 7's existence check does
the same work). What you are checking for at this door is **a list of
signals with commands attached**, not a picture of a loop. A picture someone
drew in their head has no commands under its edges, and you cannot write a
`run:` from it; a "yes" to "do you have a diagram?" therefore leaves you
exactly where you started, which is why that is not the question.

Otherwise, inventory the repository yourself. Look where this project keeps
its commands: `package.json` scripts, Rakefile or Makefile targets, CI
workflow definitions, the contributing docs. **Write down the exact commands,
and — where one can be run cheaply right now — roughly how long the slowest
one takes.** Step 4 wants that number.

**Expect two situations in which you cannot get it here, and neither is
yours to force.** The dependencies are not installed in this clone, and
installing them is exactly what step 7 rules out as irreversible; or every
check is going to be one you compose, in which case there is nothing in the
repository to time yet and the first run of each is step 7's. Note which
commands are unmeasured and carry on. Step 4 says what to do with a number
you do not have, and step 7 is where the measurement turns up, if it turns
up at all.

**Material comes from three places, and only the first is lying in plain
sight:**

- *Commands the repository already has.* `npm test`, `bundle exec rspec`,
  `make lint`.
- *Commands you compose from a rule the repository does not run.* Some of
  those rules are written down — "never commit a secret", "every migration
  is reversible" — and a `grep` or `test` one-liner can often decide them.
  **Others are written nowhere at all.** A repository's strongest invariant
  is often one only its history states: the English and Japanese copies of
  a spec have never once moved apart; nothing under `logs/` has ever been
  deleted. Prose is where you look first, but `git log` is where the rule
  with no exceptions usually is. When you find one there, say what you
  found and check it with the person before gating on it.
- *Checks on the artifact a step is supposed to produce.* "The spec file
  exists and has an `## Acceptance` section", "the review verdict says
  APPROVED".

**What a gate proves is decided by one question: could the agent pass it just
by deciding to?** Not by where the command came from, and not by what it
reads taken by itself — the checks worth writing very often read both the
tree and something the agent wrote, so "what does it read" has no answer for
them. Sort every check you are considering onto that line, because it is the
one you will have to report at the end. **It has three positions, not two.**

- **Unfakeable** — the command reads the tree and git only, and leans on
  nothing this run produced: a test suite, a diff against `HEAD`, a fact
  about the history. It proves something about **the state of the work**, it
  stays true whoever produced that state, and the only way past it is to make
  it true.
- **Fakeable** — the command reads a declaration this run wrote about
  itself, and nothing else: a verdict, a route, a note under
  `.headsign/tmp/`. It proves **a step was taken**, and nothing beyond that.
  Writing the file passes the gate.
- **Anchored — the middle, and where a great many working checks land.** The
  command reads a declaration, **but measures it against the tree or git**.
  `git diff "$(cat .headsign/tmp/base)"` reads git; what the agent supplied
  is the range. A phase that records a date and then gates on what the
  history holds since that date is the same shape. A declaration that is
  simply untrue does not survive the comparison, so an anchored check is
  stronger than the declaration it starts from — and weaker than an
  unfakeable one, because everything it proves is proved *relative to* that
  declaration.

**An anchored check is only anchored if something guards its anchor.** All
the strength borrowed above rests on `.headsign/tmp/base` naming a real
commit, rather than whichever commit makes the diff say what the agent would
like it to say. So write that guard as a check of its own — that the base
file is non-empty and `git cat-file -e "$(cat .headsign/tmp/base)^{commit}"`
succeeds — and **put it first in the gate**, ahead of everything that uses
the base. Checks run in order and the first failure stops the gate, so first
is exactly where a guard belongs. A gate whose anchor is unguarded is not in
the middle at all: it is fakeable with one extra step, and that is how you
should report it.

**How long an anchor lasts, since the whole classification rests on it being
this run's.** `.headsign/tmp/` is run-scoped: `start` deletes it whole and
recreates it empty, and a phase's `clear:` folds its own listed files away on
every entry. Nothing else resets either one. So an anchor written under
`tmp/` by the entry phase is good for that run and is *necessarily* new in the
next one — which is also the cheapest way to get a per-run identifier when a
path needs one, without the workflow having to invent uniqueness. The trap is
the opposite direction: an anchor taken **per phase entry** goes stale as a
run-scoped claim, because a second entry finds the first entry's anchor still
sitting there and measures against it. Decide which of the two you want, and
say which in the handover — "anchored" does not say when.

**Ordering is not the only way to place a guard, and it is the fragile way.**
The guard-goes-first rule above rests on the order of lines in the gate, which
nothing checks: put the guard second and every run still passes for as long as
the anchor happens to be good, then the anchored checks quietly start measuring
against an empty or bogus base — the classification drops from anchored to
fakeable with no failure anywhere to notice it. If a gate has more than one
check leaning on the same anchor, prefer closing the order inside one place:
have each anchored check call the guard's test at its own start (a small
script that validates the base and then measures), so there is no arrangement
of the gate's lines that can skip it. The gate then holds one check per claim
rather than a sequence that has to stay in the right order.

**Provenance is a different axis, and mixing the two is a real mistake.**
A check you composed yourself out of `git diff` is every bit as strong as one
lifted from `package.json`; a check that greps a file the agent wrote a
second ago is fakeable even if a `Makefile` target wraps it. Where a command
came from decides only *how you verify the command itself* (step 7: look it
up, or run it once).

**Where the repository's product is documents, artifact checks land on all
three, so judge them one at a time.** "The draft has an `## Acceptance`
section" reads a Markdown file this run wrote a minute ago: typing the
heading passes it, and it is fakeable however central that document is to the
project. "No line has been removed from `logs/`" — `git diff HEAD --numstat
-- logs/`, deletions summing to zero — reads git about a file of exactly the
same kind, and nothing the agent writes gets round it: unfakeable, and it
constrains the state of the work as tightly as a test suite does elsewhere.
What a check does with the artifact decides its position; that the artifact
is a document decides nothing.

**Being unfakeable is not the same as demanding much.** A gate asserting that
`git status --porcelain -- src/` is non-empty reads the working tree and
cannot be talked out of what it finds there, and touching any file under
`src/` satisfies it. The line decides what *kind* of claim a check can make;
how much it demands within that kind is still yours to judge, and to say out
loud.

**Scope every `git status` check to a path — always.** headsign keeps its own
volatile files out of git, by writing and maintaining `.headsign/.gitignore`
at `start` — but that file and the workflow next to it are themselves
untracked until somebody commits them, and committing is the person's call,
not yours (step 8). So in a repository that has just adopted headsign, a bare
`git status --porcelain` reports `?? .headsign/` and never comes back empty:
a gate asserting it is non-empty passes forever and proves nothing, and a
gate asserting the tree is clean fails forever however careful the work was.
`-- src/`, `-- docs/`, `-- logs/`. Name the paths you actually mean, and the
run's own bookkeeping stays out of your verdict.

**A workflow whose gates are all fakeable stops skipping, not bad work.**
Writing a non-empty file passes it, so work that is off-target still
advances. That is a use, not a defect — the design workflow this repository
runs on itself is exactly that, and what it stops is skipping the step where
you argue with your own conclusion. But it means **you must be able to tell
the person which of the three each of their gates is.** A fakeable gate
handed over without saying so is received as a stronger guarantee than it is.

**Do not assume tests are the requirement.** A workflow whose every `run:`
is a `grep` or a `test` is a working workflow; this repository runs one.

**Refuse only after looking in all three places material comes from.** If
there is genuinely nothing here a shell command can judge, say so and do not
draw a loop — a gate with nothing mechanical under it is a guess in the
clothes of a design.
When you stop, **name what would make it possible** ("a test command, or a
rule — written down or visible in the history — specific enough to grep for,
or an artifact each unit of work is supposed to leave behind"), and stop
there. Do not build it (see *What this skill does not do*, 4).

### 2. Work out the unit of work, and split it into phases

**New workflow?** The question is *what a typical unit of work is here*.
Read the recently merged pull requests, skipping dependency bumps and
chores; if the project commits straight to its main branch, read the recent
commit history instead — it is the same evidence kept elsewhere. Split that
unit into phases yourself, usually two to five, each ending in something a
command from step 1 can check.

**Revising an existing one?** The question is *what about the current
workflow is not fitting*. Answer as much of it as you can before asking
(see *Asking well*): read the workflow file, and read `.headsign/log`, which
records the path runs actually took — a phase that is retried repeatedly, or
one that escalates every time, is a shape complaining about itself. Then ask
about what you could not work out.

Both entrances rejoin here, and everything from step 3 on is the same.

**Size the phases to what a gate can actually check**, not to how the work
naturally breaks down. A test gate proves nothing broke; it does not prove
the feature is done. Work no shell command can judge — a design call, a UX
decision — has three honest destinations, and you should say which one you
chose for each: slice it into units a check can verify, carry it with a
review phase whose gate reads a verdict file, or leave it to the human
reviewing the pull request.

### 3. Draw the shape, and agree it

Draw the phases and the edges in ASCII: the pass edges, the edge taken when
a gate fails and the work goes back for rework, and the branch if the work
has one. Show it to the person and settle it **before** writing YAML — a
shape is cheap to argue with as a picture and expensive to argue with as a
file. This same picture becomes the file's header comment in step 6.

**A straight line is a complete workflow.** If the work does not branch, do
not add a branch to make the graph look serious; what the graph is doing for
a straight line is holding the stopping condition.

### 4. Choose the numbers

Three numbers go into a workflow, and being wrong about them costs three
different things — so they get three different treatments.

- **`limits.max_total_iterations` (the ceiling) — decide it yourself.**
  Being wrong is recoverable: the run stops and asks a person, but stays
  alive, and raising the number and running `headsign next` continues from
  the same phase with attempts intact. A one-line reason in a comment is
  enough. Base it on the phases: roughly the number of gate evaluations one
  honest pass takes, with room for the usual retries. **It bounds one run, not
  one tree.** `start` sets the count to zero, so a second run over the same
  directory gets the whole allowance again, and `max_attempts` starts over with
  it. That is not a hole to be plugged — it is what the number means — but it
  decides a design question you should answer on purpose rather than discover:
  work that arrives in instalments (an answer comes back, one more pass is
  needed) can either be a fresh `start` each time or one run whose route goes
  back a phase. **Restarting gives each instalment its own budget and its own
  round numbering, and folds `tmp/` away between them; the loop keeps one
  budget, one log, and one set of round numbers across all of them.** If
  anything downstream counts rounds or builds a path out of a round number,
  the loop is the form that keeps those meaning what they say — and if you
  restart instead, nothing carries over except what the workflow itself wrote
  outside `tmp/`.
- **`max_attempts` — propose it, but do not settle it silently.** Running
  out ends the run for good, and redoing the work means starting again from
  the entry phase. Give the number, the reason, **and the consequence**
  ("if this is exhausted the run is over") and let the person confirm or
  change it. Draw the proposal from what the phase is: phases where going
  round several times is part of the job (implementation, rework after a
  rejected review) get more; phases that should land in one pass get fewer.
- **`timeout:` — never guess it. It goes one of three ways, and you say
  which.** The field defaults to 120 seconds, so leaving it out is a
  decision as much as writing a number is, and it is the right decision
  more often than not. Use whatever measurements you have in hand — from
  step 1 if the command could be run there, from step 7 if that is where it
  runs for the first time. Having none in hand is a reason to go and get
  them and come back here, not a reason to invent a number:
  - **You measured it, and a ceiling is warranted** — the command is slow,
    or slow on a bad day. Set the number, with the measurement behind it in
    a comment.
  - **You measured it, and the default already has room** — the slowest
    check finished in a fraction of a second. **Leave the field out**, and
    put the measurement in a comment saying that is why. Omitting is not a
    kind of guessing when a number stands behind it; the comment is what
    makes the difference visible to the next reader.
  - **You could not measure it at all** — dependencies are not installed
    here and installing them is out of bounds, or the suite wants a service
    you do not have, and step 7 will not change either. Leave the field out
    or set a provisional number derived from something already declared (a
    suite-wide timeout in the CI definition, say), write where you got it,
    and **tell the person that it is unmeasured and wants measuring once the
    command can actually run**. What is forbidden is a number with nothing
    behind it arriving silently.

**Getting `timeout:` wrong is the worst of the three, because it lies about
why it failed.** A test that is merely slow today times out, the gate fails,
one attempt is spent, and the agent reads "the tests failed" and starts
fixing code that is not broken. The other two announce what happened.

**Ask once for the whole file, not once per phase.** Present every phase's
numbers together with the reasoning, and let the person change only the ones
they want to. Not because asking is pointless — because asking requires the
explanation first, and that explanation repeated once per phase is noise.

### 5. Choose the names, and check the path is free

There are two names, and they are for different readers. **The file name** is
what someone types to start the run (`headsign start fitness` reads
`.headsign/fitness.yaml`), so it wants to be short. **`name:`** is the label
that appears in `headsign status` and in `.headsign/log`, so it wants to say
what the run is.

Decide both by rule, then announce them:

- **`.headsign/` holds no workflow at all → `workflow.yaml`**, which
  `headsign start` finds with no argument. Least friction.
- **Something is already there → a short name for the job**, checked against
  the existing files so it does not collide.
- **`name:` says what the job is.** Matching the file name is fine when the
  file name already says it; the rule is "a reader can tell what run this
  is", not "must differ".

Do not ask first. Being wrong is free to fix **before the run starts** — and
not after, so say that when you announce it. A run records the path it was
started with and goes looking for exactly that path on every lap: rename the
file mid-run and `headsign next` can only report that it cannot read the
file, with restoring the name or abandoning the run as the two ways out.
(And "free before the start" is only true of this machine: once the file is
committed and someone else has cloned it, a run of theirs is beyond what you
can see.)

**Before writing, check whether a run is in flight on the path you are about
to write.** `headsign status` is read-only and safe to call at any time; it
reports `RUNNING` and the workflow if there is one.

**In a repository with no `.headsign/` yet, `status` prints an `ERROR:` line
and exits 3. That is the answer, not a failure.** It means "there is no run
here to read", which is exactly what you expect to find when you are writing
the first workflow. Nothing needs fixing and nothing needs reporting; go on
to write the file. (Exit 3 is headsign's code for "this question does not
apply here" as well as for a broken invocation — it never reuses `next`'s
1 and 2, so reading status can never look like a verdict.)

This check is not a rule about
revision — creating a *new* file at the path a live run is using lands in the
same dead end. If a run is live on that path, say so, and **keep the phase it
is standing on defined under the same name**: a run whose current phase
disappears from the file stops with `workflow '<path>' no longer defines
phase '<phase>'`, and the only recoveries are putting the phase back or
aborting the run.

### 6. Write the file

`.headsign/<name>.yaml`. The vocabulary is in *The vocabulary you need*
below; anything it does not cover is in `references/schema.md`. What the
comments must and must not carry is in *What goes in the comments*.

### 7. Verify what you wrote

**Always run `headsign validate --workflow .headsign/<name>.yaml`.** It runs
no gate and touches no state, so it is safe at any moment, including while
another run is going. Errors exit 3 and must be fixed. Warnings print to
stderr and still exit 0 — an unreachable phase you have not wired up yet is
a warning, deliberately, so half-written work does not stop anything.

**`validate` never looks inside a shell string.** A workflow whose only check
is `run: "npm tset && definitely-not-a-real-binary"` validates clean and
exits 0. So validating is necessary and nowhere near sufficient, and what you
do next depends on **where each command came from** — the axis that is about
*how to check the check*, and says nothing about how strong the gate is
(step 1 draws that other line, and it has three positions on it):

- **Commands taken from the repository — check that they exist, do not run
  them.** Is that script name in `package.json`? Is that target in the
  Makefile? Is the binary on `PATH`? Running them is slow, and some of them
  are *supposed* to fail right now. Say so when you hand over: "this one is
  what CI runs; I have not run it here." Be honest about the size of that
  claim — the evidence is that it ran *somewhere*, not that it runs *here*;
  a line lifted from a CI definition ran with CI's environment, credentials
  and network.
- **Commands you composed — run each one once.** They were born a minute
  ago and nothing anywhere is evidence that they work. **Compose only
  read-only predicates** (`grep`, `test`, `git diff`, and the like) so that
  running them can break nothing. Note that "read-only" does not mean
  "local": a composed `gh repo view --json visibility` reads nothing on
  disk but demands network and authentication.

**Try the failing path too, not only the passing one. This is recommended,
with conditions.** A check that has only been seen to pass has not been seen
to work. Three shapes are dangerous, and they look identical from outside —
all three are simply green.

The first **asserts an *absence*** — no secret in the diff, no deleted line
in the log, nothing past the deadline. A misspelled pattern in it passes on
a clean tree exactly as a correct one does, forever, and no amount of
running it in that state tells them apart.

The second is **a check that is correct, runs correctly, and is not about
the work** — its reach stops short of where the work is. A test command
whose glob covers the directories the runner was written for says nothing
about a tree it never visits, and it says nothing in the same green it uses
for real approval. **Suspect this one whenever you are swapping a gate
rather than writing the first one.** A substitution is usually made because
the original was not reaching something, and nothing has yet been shown to
reach it — so the case that made you replace the gate is the case the new
one is likeliest to miss as well.

The third is **a check that is correct, reaches the work, and is green
because an earlier run's output is still lying there.** `start` empties
`.headsign/tmp/`, and that is the whole of the boundary between one run and
the next — a file listed in a phase's `clear:` is gone by the time the phase
is entered, but everything a workflow writes outside `tmp/` outlives the run
that wrote it, which is exactly what makes it an artifact. A gate that reads
those artifacts passes on the previous run's work, in the same green it uses
for this one, and the second run can reach that phase and do nothing at all.
The tell is in how a path is composed: **if a gate reads a path built from a
value that `clear:` resets, the path repeats itself every run while what it
names does not.** Compose the path from something a run cannot repeat — mint
an identifier into `.headsign/tmp/` when the entry phase runs and put that in
the path — or have the gate demand something only this run can have produced.

Make the condition each check is hunting for actually occur — for the
second shape, break something *in the area the swapped-in gate is supposed
to cover*; for the third, run the workflow twice in the same tree and see
whether the second run's gate still needs work done — and confirm the check
notices. Composing read-only predicates
makes *running* a check harmless; making one fail is a separate act, which
is what these conditions are for:

- **Look for a way that touches no tracked file first.** A scratch file
  outside the repository, an environment variable, pointing a path argument
  somewhere else, a `grep` fed a string on stdin. Do not reach for `git
  stash` — it moves work you did not put there, and it is a second thing to
  undo.
- **If you do have to change a tracked file, put it back at once, and check
  that you did.** Plant the token, run the check, remove it, and confirm
  `git status` is back to what it was before you started — every time,
  before moving on to the next check. Do not batch the reverts.
- **Nothing irreversible.** No commit, no push, no installed dependency, no
  rewritten history. Those are not "read-only" bent a little; they are a
  different act, and undoing them is not free.

**When a check fails, sort the failure into one of four kinds. Only one of
them is yours to fix.**

| The failure | What it means | What to do |
|---|---|---|
| The work is not done yet | Normal. The spec file is missing because nobody has written it | Nothing. The gate is working |
| The gate is supposed to fail here | Normal. A red-test check asserts failure on purpose | Nothing |
| Broken as shell | Bad quoting, a wrong flag, a pipeline that swallows the exit code | Fix the command |
| The environment is not here | Missing binary, no credentials, no network | **Do not rewrite it.** Tell the person |

Rewriting the fourth kind is how a correct check quietly becomes a weak one.

### 8. Hand it over, and stop

Report, in this order: the path you wrote; the one line that starts it (with
the workflow's name as an argument, unless you wrote `workflow.yaml`); the
shape; **which gates are unfakeable, which are anchored, and which are
fakeable** — and, for each anchored one, what its anchor is and which check
guards that anchor; which commands you checked by existence, which you
actually ran, and which you also saw fail on purpose; the numbers, including
any `timeout:` you left out and any you could not measure, and flagging the
`max_attempts` values you want confirmed; anything you had to decide without
an answer (see *Asking well*); and the reminder that renaming is free now and
not after the first `start`.

**Report the three tiers as three groups, not as strong-and-weak.** The
middle is the one a reader will otherwise round to whichever end suits them,
and it is where most of the interesting checks are. Naming the anchor and its
guard in the same breath is what lets the person judge the group at all —
without that, "anchored" is a word, and they cannot tell it from a fakeable
gate wearing a `git` command.

**Give the start line in the form that will still work next week.** The
canonical one is `headsign start` (with the workflow's name as an argument
unless the file is `workflow.yaml`), and it is the right line for anyone who
has the command on their `PATH` or reaches it through `npx`.

**Do not paste the path you have been running yourself.** When this skill
runs inside its plugin, the invocation you were handed is an absolute path
into the plugin's cache, and that path contains the plugin's version — it
stops existing the next time the plugin updates. It is the correct way for
*you* to call the CLI in this session and the wrong thing to write down for
someone else.

So: if the person has `headsign` on their `PATH` or in their project's
`node_modules`, give them `headsign start …` or `npx headsign start …` and
you are done. If they only have it through the plugin, there is no short
command to give — say so, and tell them to ask their agent to start the run
instead. The `workflow` skill drives runs and works out how to reach the
bundled CLI on its own, which is exactly the indirection that keeps a
version-pinned path out of their notes.

**Do not commit the file.** It belongs in version control — that is where a
workflow is meant to live — but putting it there is not your call. Writing
it is what was asked for; committing it is a separate act. Some repositories
also have a rule about what may be committed at all — an allow-list of paths
that does not mention `.headsign/`, a convention about generated files, a
review step. If you can see such a rule here, say that the new file runs
into it and leave the choice with the person; a workflow file that quietly
breaks the repository's own commit policy is a poor first impression for the
tool.

Then stop. Do not start the run.

## The vocabulary you need

This is enough to write one simple workflow correctly. The complete field
table, the router pattern, and the less common branches are in
`references/schema.md` — read it when you need a field that is not here.

```yaml
version: 0.1              # exactly 0.1; the schema is pre-1.0
name: feature-dev         # the label in `status` and .headsign/log
entry: plan               # the phase a run starts on

phases:
  plan:
    # Handed to the agent verbatim when it enters the phase. This is where
    # you say what to do — including "use skill X" or "spawn a reviewer".
    description: Write the spec to docs/spec.md, with an "## Acceptance" section.
    gate:
      checks:                       # run with /bin/sh -c, in order;
        - name: spec exists         # the first failure stops the gate
          run: "test -s docs/spec.md"
        - name: acceptance criteria present
          run: "grep -q '## Acceptance' docs/spec.md"
    on_pass: implement              # a phase name, or $end
    max_attempts: 3                 # failures before the run escalates

  implement:
    description: Implement per the spec, test-first.
    gate:
      checks:
        - name: unit tests
          run: "npm test"
          timeout: 300              # seconds; default 120
    on_pass: review
    max_attempts: 5

  review:
    description: >
      Have a read-only reviewer subagent report APPROVED or REJECTED, then
      write that verdict yourself to .headsign/tmp/verdict.
    clear: [.headsign/tmp/verdict]  # deleted on entry to this phase
    ready: "test -f .headsign/tmp/verdict"   # judge only once this passes
    gate:
      checks:
        - name: review approved
          run: "grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: $end
    on_fail: implement              # rejection goes back for rework
    max_attempts: 3

limits:
  max_total_iterations: 20          # global runaway backstop
```

`on_fail` defaults to `retry` (stay in the phase) and also accepts a phase
name, `$end`, or `escalate` (stop and ask a person). No gate can end a run
outright: exhausting `max_attempts` escalates, and only a person running
`headsign abort <reason>` aborts.

**Quote any `name:` that contains a colon.** Check names tend to quote a
fragment of the command they run, and `- name: verify git status: clean` is
not a headsign error but a YAML one — `Nested mappings are not allowed in
compact mappings` — so `validate` exits 3 having read no fields at all.
`- name: "verify git status: clean"` parses fine.

**`run:` is where quoting actually bites, and it bites more often than the
colon does.** A shell command that wants a single quote — `grep -q '##
Acceptance' docs/spec.md` — cannot sit in a YAML single-quoted scalar without
doubling every one of them, and the double-quoted scalar is not the way out
it looks like: inside it YAML owns the backslash, so `\$` is not a shell
escape reaching the shell but an unknown YAML escape, and the parser rejects
it. Writing every check with double quotes only, to keep out of the way of
the outer quoting, is a restriction on your shell that you should not accept
silently. **Use a block scalar instead** — `run: >-` folds the lines into
one, `run: |` keeps the newlines — and inside it the quoting is the shell's
business alone, with no YAML escapes to work around. Whichever way you write
it, the guarantee is not the quoting rule: it is step 7, where you take the
string back out of the YAML and run the thing you actually wrote.

### Ways of writing it that look right and are wrong

`validate` catches misspelled keys and undefined destinations — those you
will hear about on the first run of it. **These four it cannot catch**, and
they are what a workflow author actually walks into. A file with any of them
validates clean and misbehaves later.

1. **`on_fail: retry` and `on_fail: <this same phase>` are not the same
   thing.** `retry` stays: the answer is `RETRY`, the work continues on the
   same failure, and the phase's `clear:` does **not** run. Naming the phase
   itself leaves it and re-enters it: the answer is `ADVANCE`, and `clear:`
   runs, deleting what it lists. Re-entering is right when starting fresh is
   the point — a stale review verdict has to go — and wrong when the agent
   should keep working on the same failure.
2. **`clear:` runs on entry to a phase, and only then.** So a review phase
   that lists its verdict under `clear:` but sets `on_fail: retry` clears the
   verdict exactly once, when it is first entered, and never again: the
   rejected verdict it is supposed to throw away stays on disk while the
   agent retries against it, and the gate goes on reading last time's answer.
   That combination validates clean, and where a verdict is involved it is a
   mistake. Decide which of the two behaviours you meant.

   **The same pairing is right when the file is written once and must not
   move.** A phase that lists `.headsign/tmp/base` under `clear:` and then
   records this run's base commit in it wants precisely this: cleared when
   the phase is entered, written once, then left alone through every retry,
   so that the anchored checks downstream keep measuring against one fixed
   point instead of a point that walks forward with the work. Clearing on
   entry is what makes a genuine re-entry take a fresh base; `retry` is what
   stops a retry from moving the mark mid-phase. The test is what the
   `clear:` is there for — if what you need gone is **last time's verdict**,
   `retry` is the wrong partner for it; if what you need kept is **this run's
   anchor point**, it is the right one.
3. **Without `ready:`, calling `next` too early costs an attempt on a gate
   that had nothing to judge.** Any phase whose gate waits on something
   slower than the loop — a reviewer subagent still reading, a human at a
   pull request — wants a `ready:` probe. An early `next` then answers
   `PENDING` instead: no attempt spent, `clear:` not run, and the artifact
   left where it is instead of being deleted by a re-entry a moment before
   it arrives.
4. **A list-form `on_pass` is read only after the gate passes, and never on
   the failure path.** Routes are how a *passing* phase picks among several
   destinations. A router phase whose own gate fails is an ordinary failing
   phase, and no `when:` will ever see it — failure routing is `on_fail`'s
   job alone.
5. **A `when:` must test that the destination can be *started*, not that
   work appears to exist.** These come apart, and the gap is expensive. A
   predicate that greps for units marked ready sends the run onward while
   every ready unit is blocked on something unfinished; the destination's gate
   then asks for a unit to have been picked, nothing can be picked, and the
   phase burns its `max_attempts` on empty laps — and exhausting them ends the
   run, so a mistake in one routing predicate is paid for by the whole walk.
   Write the predicate as the destination's own entry condition: not "is there
   something marked ready" but "is there something this phase could actually
   take". **And note what it will look like when you get it wrong**: the record
   will show a gate failing, over and over, in a phase where nothing is wrong
   with the work. Nothing in the run says "the routing sent you here by
   mistake", because nothing can tell — so a phase that keeps failing with an
   unchanged verdict is a reason to suspect the route that feeds it, not only
   the work in front of you.

## What goes in the comments

**The rule is a purpose, not a list: write down what a reader cannot get by
reading the file.** A workflow file states what happens. It does not state
why this shape, why this number, or how much a gate is actually worth — and
those answers exist only in the conversation that produced them, which does
not survive. The comments are the only place they can live.

**Three things are required, and every file carries all three.**

1. **The shape, in the header** — the phases and the edges, in ASCII. This is
   the picture from step 3; putting it here gives it a life after the
   conversation that produced it.
2. **What a gate proves and what it does not** — required on **every
   fakeable gate and every anchored one** (step 1's line), because those are
   the two a reader will over-trust; an anchored gate's line says what its
   anchor is and which check guards it, since without that it cannot be told
   from a fakeable gate holding a `git` command. Also worth a line wherever
   the position is not obvious from the command: a check on a document can be
   any of the three, and the reader should not have to work out which for
   themselves.
3. **A mark that a command was composed** rather than lifted from the
   repository. Whoever reads this file next needs to know which lines to
   check against the project and which to check by running them. Commands
   taken from the repository need no mark.

**Those three are the floor, not the ceiling.** Anything else a reader would
otherwise have to guess at belongs here too. In particular, **the reasoning
behind any number in the file**:

- The ones step 4 asks you to record — why the ceiling is 20, why this
  `timeout:` is 300, and why a `timeout:` is *absent*, with the measurement
  that made the default sufficient or the note that it could not be
  measured. Step 4 tells you to write these down; here is where they go.
- Any threshold you chose inside a check's own command — why the
  description has to be 40 characters and not 10, why three sections and not
  two. A number picked in conversation is invisible in the `run:` string
  that ends up holding it.

**Never drop a check because its reason has nowhere to go.** If the only
thing standing between a check and the file is that you cannot see where to
put its justification, the answer is a comment above it, not a smaller
workflow. A formatting rule that quietly deletes design decisions is worse
than a file with one comment too many.

**A note that holds uniformly goes in the header, once.** If fifteen of
sixteen checks were composed, marking all fifteen restates the file's own
shape and buries the one line that matters; write "every check below is
composed unless noted otherwise" in the header and mark the exception.
The same applies to any other note that is true everywhere. Repetition at
that scale is the bulk the next rule is about.

**What is forbidden is restating what is already on the page.** `# this
phase does the implementation` above `implement:` tells a reader what
`implement:` already told them. The test is the purpose above: could a
reader get this from the YAML? If yes, it is bulk, not explanation — and
bulk is not harmless, because it is what makes the real comments hard to
find.

**These go in comments, not in `description:`.** `description:` is handed to
the working agent verbatim at run time; comments are never read by headsign
at all. Everything above is addressed to a different reader — the person
deciding whether to trust this workflow, and whoever comes back later to
change it — and mixing it into `description:` muddies the instruction the
agent is actually meant to follow.

**Write them in the repository's language, not this project's.** headsign's
own convention is English comments, but you are writing into somebody else's
repository: match the language of the comments and README you find there,
and if that does not settle it, match the language the conversation is in.

**The rule generalizes, and it splits by destination: what stays in the
repository takes the repository's language, what is handed to a person takes
the language you are talking in.** Comments and any file you leave behind
follow the repository. The hand-over report of step 8, and the questions of
*Asking well*, follow the conversation — they are read once, by the person
in front of you, and translating them into the repository's language serves
nobody.
