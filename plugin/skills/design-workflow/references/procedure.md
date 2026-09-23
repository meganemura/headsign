# The procedure

Read this to design or revise a workflow. The entry skill's constraints still
apply: do not start a run on your own judgment, do not delete or rename a
workflow file, and do not build checks the repository is missing.

Sibling references, opened when a step names them: `asking.md`,
`vocabulary.md`, `schema.md`, `pitfalls.md`, `checks.md`, `comments.md`.

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

**A mark under `tmp/` belongs to this run, and a path written inside it can
lead anywhere.** A phase writes the directory of the screenshots it took into
`.headsign/tmp/shots`, and the gate counts the image files it finds at that
path. `start` emptied `tmp/`, so the mark is this run's. The images sit outside
`tmp/`, where nothing was emptied, so a directory an earlier run filled passes
the count exactly as well as a fresh one does. The check reads a declaration
and measures it against the filesystem, which has the shape of an anchored
check, and what it proves is that three files exist somewhere. The claim it was
written for was that this run produced them.

**The anchor is whatever headsign deletes.** There are two deletions: `start`
empties `tmp/` for the whole run, and a phase's `clear:` folds its own listed
paths away on every entry. An artifact behind one of them belongs to this run
by construction. An artifact outside both needs git to date it, and which
command does that depends on what the phase does with the file: `git status
--porcelain -- shots/` sees a file the round wrote and has not committed, and a
diff against a base commit the run recorded sees one the round committed. A
phase that sometimes commits and sometimes does not needs a check that accepts
either. A timestamp settles nothing here, because a check has no run-scoped
clock to compare one against.

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

**Names to hand someone who does not use this vocabulary.** These three
positions are this skill's own scheme, and a handover report written in them
has to define them first. Neighbouring fields have named the tiers separately,
so a report can borrow rather than define. *Fakeable* is what supply-chain
provenance work calls trivial to bypass or forge at its lowest level, and
in-toto names the specific attack — a **fake-check**, where a step reports a
verification it never performed. *Anchored* is the shape remote attestation is
built on: a claim is appraised against a reference, and **freshness** is its
own named property, because an appraisal against a stale anchor is a different
thing from one against a current anchor. The strongest position has no single
borrowed name in what was surveyed; reproducible builds and implicit
attestation each name a particularly strong form of it rather than the class.

**One neighbouring contrast is the wrong one to borrow: "measured versus
asserted".** It is tempting, and it reads as though it maps onto fakeable
versus unfakeable. It does not: the trusted-computing framework that defines
those terms makes a measurement *a kind of* assertion, so importing the pair
would put a reader who knows that field at odds with the text. Prefer the tier
names above, or say what the check reads.

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
there. Do not build it (see the entry skill, *What this skill does not do*,
item 4).

When a rule you would gate on is a sentence rather than a structure, read
`checks.md` (*When the claim lives in prose*) before you write the check.

### 2. Work out the unit of work, and split it into phases

**New workflow?** The question is *what a typical unit of work is here*.
Read the recently merged pull requests, skipping dependency bumps and
chores; if the project commits straight to its main branch, read the recent
commit history instead — it is the same evidence kept elsewhere. Split that
unit into phases yourself, usually two to five, each ending in something a
command from step 1 can check.

**Revising an existing one?** The question is *what about the current
workflow is not fitting*. Answer as much of it as you can before asking
(see `asking.md`): read the workflow file, and read `.headsign/log`, which
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

How many phases, and how many checks in one gate, is `checks.md` (*How much
gate is enough*).

**Then check each phase against the round that has no work for it.** If a unit
of work can legitimately leave one phase with nothing to produce, that phase
needs an edge that carries such a round past it; `checks.md` (*A round that has
nothing for a phase*) has the shape and the reason.

### 3. Draw the shape

Draw the phases and the edges in ASCII: the pass edges, the edge taken when
a gate fails and the work goes back for rework, and the branch if the work
has one. Use the picture to check the required outcomes and explain the design.
Proceed within the task's authority; ask only about unresolved requirements
or constraints. This picture becomes the file's header comment in step 6.

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
- **`max_attempts` — explain the choice and preserve agreed budgets.** Running
  out ends the run for good, and redoing the work means starting again from
  the entry phase. Give the number, the reason, **and the consequence**
  ("if this is exhausted the run is over"). Use a delegated design choice when
  authorized; otherwise ask the person to settle the budget. **Say what the number counts, because it is not what most
  readers assume**: failures of that phase since it last *passed*, which is
  not the same as failures since the run last entered it. A route that leaves
  the phase on a failure and comes back later — through another phase, or
  around a longer way — finds the count where it left it, so a phase that is
  visited three times before it passes has three visits' worth of failures
  against one budget. That is the property the graph rules lean on: a cycle
  closing through a failure edge is bounded precisely because the count does
  not reset, which is why `validate` does not warn about one. Size the number
  to how many times the work can fail *before it succeeds*, and where a phase
  is meant to be attempted afresh on each visit, say so in a comment, because
  the file cannot. Draw the proposal from what the phase is: phases where going
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

`.headsign/<name>.yaml`. The vocabulary is in `vocabulary.md`; anything it
does not cover is in `schema.md`. What the comments must and must not carry
is in `comments.md`. A check and the instruction that satisfies it are one
edit (`checks.md`).

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

**A check that writes costs the driver something specific, so decide it on
purpose.** Read-only checks have a property worth naming: whoever is driving
can run them by hand, in any order, as often as they like, and find out what
the gate would say without calling `next` — which is the only judgment, and the
only thing that spends an attempt. Drivers do this, and a phase where the whole
gate can be rehearsed that way is a phase whose attempts get spent on real
failures rather than on finding out.

One check that writes takes that away for the entire gate. The rest can still
be run by hand, but not all of them together, and the driver has to open the
scripts to work out which one is unsafe. That is a real price and it is
sometimes worth paying — the loop pattern in *A loop wants two checks*, below,
pays it deliberately, recording its comparison mark in the gate's last check
because that is the one moment that means "a round which passed every judging
check". If you take that trade:

- **Keep the writing check last**, and say in a comment that its position is
  load-bearing rather than incidental.
- **Say that it writes, at the check**, so the driver reading the gate can tell
  which checks are safe to rehearse without opening every script.
- **Prefer the phase's own work** for anything that does not need to happen
  exactly at the moment the gate passes. A side effect in the gate is only
  earned by needing that instant.

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

**A loop wants two checks, and only one of them is about progress.** The three
shapes above are all a gate going green when it should be red. This one is the
other direction, and it comes from the same confusion, so it is worth having
both sides in view.

**A measure is not a stopping condition.** A gate that demands "fewer left than
last round" is a measure. The standard way of arguing that a loop terminates
keeps those apart, and has since Floyd put it in print in 1967: the quantity
falls in a well-founded order on every round *that goes around again*, while
leaving the loop is licensed by a **separate** claim about the state where it
can fall no further. Floyd's W-function into a well-ordered set, Dijkstra's
variant function beside his invariant relation, `loop variant` beside `loop
invariant` in ACSL, `decreases` beside `invariant` in Dafny — four
formulations, same division of labour.

**Your measure has a floor, and the round that lands on it is the round that
must be allowed to leave.** A count of unfinished items bottoms out at zero, so
a gate that asks for a decrease *there* cannot be passed by a loop that has
legitimately finished — nothing is smaller than zero. ACSL says as much
directly: the variant's value at loop exit may fall below the bound without
compromising termination. Dafny says it from the other side: once the measure
reaches the bottom of the order, control must leave the loop. Neither treats
the floor as a round the decrease obligation applies to.

Write them as two named checks, each guarded so it is vacuously true outside
its own regime — the conjunction is then the whole obligation, and a failure
still says which half broke:

```yaml
checks:
  - name: unfinished count fell
    run: '[ ! -f .headsign/tmp/prev ] || [ "$(sh count.sh)" -eq 0 ] || [ "$(sh count.sh)" -lt "$(cat .headsign/tmp/prev)" ]'
  - name: an empty queue is a real one
    run: '[ "$(sh count.sh)" -gt 0 ] || sh verify-really-done.sh'
  - name: record the count this round leaves
    run: 'sh count.sh > .headsign/tmp/prev'
```

That third check is not decoration and it is not optional: without it the mark
never appears, the first check is vacuously true forever, and the gate you just
built measures nothing. It goes last for the reason the next paragraph gives.

**The second check is not politeness.** A zero that came from a miscount, a
renamed directory, or a counter that quietly stopped working looks exactly like
finished work — so "pass whenever the count is zero", which is the obvious
repair when the first check blocks a legitimate finish, trades an unpassable
gate for one that passes on a broken tree. That is the same confusion coming
back inverted.

Two details decide whether this works in practice. **Record the number you
compare against in the gate's *last* check**, so only a round that passed every
judging check moves the mark and a retry never reaches it — a gate runs after
the work, so "the count at the start of this round" is not a number you can
take, while "the count the last passing round left" is the same number and is.
And **compute the exit predicate from the tree, not from the run's own
bookkeeping**: the claim is about the repository, while anything under
`.headsign/tmp/` is folded away by the next `start` — which is also why the
first check has to tolerate a missing mark rather than failing on it.

**That mark is the general mechanism for anything one round needs to tell the
next**, not just a decreasing count. A file under `.headsign/tmp/` that no
phase's `clear:` names is untouched by every phase entry and wiped only by the
next `start`, so its lifetime is exactly one run — which is the lifetime a
per-round tally wants. Write it in the last check for the reason above, and a
later round can gate on it, compare against it, or hand it to whoever is doing
the work. Reach for it whenever a quantity only means something next to the
previous round's version of itself: how many items a round settled, how many it
deferred, how many it had to ask about.

**What it cannot do is reach the instructions.** A phase's `description` is
handed to the agent exactly as written in the file — nothing substitutes a value
into it — so a round's number cannot appear in the text the next round is given.
The way across is the same one everything else uses: have the description *tell*
the agent to read the file. "Read `.headsign/tmp/settled-count` before you
start; if it is above zero, last round's questions were answerable from the
sources they already cite" is instruction the agent can act on, and the number
stays where a gate can also check it.

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

**Before the report, read `pitfalls.md`.** Those are the files that validate
and still misbehave.

Report, in this order: the path you wrote; the one line that starts it (with
the workflow's name as an argument, unless you wrote `workflow.yaml`); the
shape; **which gates are unfakeable, which are anchored, and which are
fakeable** — and, for each anchored one, what its anchor is and which check
guards that anchor; which commands you checked by existence, which you
actually ran, and which you also saw fail on purpose; the numbers, including
any `timeout:` you left out and any you could not measure, and flagging the
`max_attempts` values you want confirmed; anything you had to decide without
an answer (see `asking.md`); and the reminder that renaming is free now and
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
