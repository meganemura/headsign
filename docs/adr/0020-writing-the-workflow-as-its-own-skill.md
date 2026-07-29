# ADR-0020: Writing the workflow is a skill of its own — and the layer that writes it has two readers

- Status: accepted
- Date: 2026-07-29

## Context

ADR-0019 split the documentation by the moment it is read: the README before
you enter, `docs/workflow-reference.md` while you write the graph,
`plugin/skills/workflow/SKILL.md` while a run is in flight. Two of those
three moments have something that *acts*. The README hands the reader a
prompt their agent executes; the skill is the discipline an agent follows
lap after lap. **The middle one was a page, and the only instruction attached
to it was "go and read it".**

The gap is easiest to see at the end of the README's prompt (ADR-0019 §4).
The prompt has the reader's agent inventory the repository's signals, work
out the unit of work, split it into phases, draw the loop with a shell
command under every edge, and halt. Then nothing carries the drawing into a
file. Turning that picture into `.headsign/<name>.yaml` was the one step of
adopting headsign with no procedure anywhere: not in the README, which by
ADR-0019 §3 no longer contains a line of YAML; not in `SKILL.md`, which is
the discipline of a run already under way; and not in the reference, which
states the vocabulary but says nothing about how to arrive at a design.

Authoring is also the moment the tool's claim is either made or lost. A
workflow whose gates all read files the agent wrote a minute ago runs exactly
as smoothly as one held up by a test suite, and proves something entirely
different. Nothing in this repository said so where the choice is actually
made.

## Decision

**1. It is a second skill, `design-workflow`, not a section in the first.**
A skill's body is loaded every time the skill is selected. The `workflow`
skill is selected on every lap of every run and is 203 lines; the authoring
procedure is 715 lines with a further 190 in a reference beside it. Folding
them together charges every lap of every run for a document needed once, at
the moment a file is written. **ADR-0019 rejected folding the reference into
`SKILL.md` for exactly this reason**, and the same arithmetic applies to the
procedure that uses the reference.

**The seam between the two skills is what is being asked for — writing the
graph or walking it — and not whether `.headsign/` exists.** Adding a second
workflow to a repository that already has one satisfies both conditions at
once, and this repository is the counterexample the seam was checked against:
it holds three workflow files in `.headsign/`, so a disk-shaped seam would
route a request to write a fourth to the skill that drives runs. The two
`description:` fields are therefore written on the *intent* axis, because a
description is the selection mechanism and not a summary of one.

**2. It surveys first, converses, and writes the YAML itself.** The `run:` of
a gate is decided by what commands the repository actually has, so nothing
can be written before the survey — and a skill that takes the survey as an
*input* has nothing left to do when the input does not arrive. Step 1
therefore begins with the survey and carries a door for someone who already
did it (the README prompt's output, or their own list), rather than being a
receiving procedure with an exception for people who bring nothing. **What
that door checks for is a list of signals with commands attached, not a
picture**: a loop somebody drew in their head has no commands under its
edges, so "do you have a diagram?" is a question whose "yes" leaves you where
you started.

The manner of asking is the one `.headsign/grilling.yaml` already imposes on
this repository: one question at a time, answer it yourself plainly before
asking, do not ask if the explanation produced the answer, and bring the
candidates with what each one costs.

**The skill is not itself driven as a headsign run.** It is the machinery for
*making* workflows; it does not have to be one. What that leaves unguarded is
named in the Consequences, and the reason it was rejected is in the
Alternatives — it is not the reason one would guess.

**3. It stops at the file, and never calls `start` on its own judgment.**
`headsign start` does not merely name a phase; it prints that phase's
instructions, which an agent's discipline is to obey. Run against a
throwaway workflow whose entry phase had `description: "do the thing"`, it
answers:

```
START only
--- phase: only ---
do the thing
```

So the user's actual work begins the moment it is called — from a file that
has never run, since `validate` is static and executes no gate. Someone who
asked for a workflow to be written did not ask for the work described in it
to begin. What is forbidden is starting on the skill's own judgment, not
starting: "write it and then run it" is a second request, and from there the
`workflow` skill takes over.

**4. Gates sort into three tiers, by one question: could the agent pass this
just by deciding to?**

- **Unfakeable** — reads the tree and git alone, leaning on nothing this run
  produced. It proves something about the state of the work, and the only way
  past it is to make it true.
- **Fakeable** — reads a declaration this run wrote about itself and nothing
  else. It proves a step was taken. Writing the file passes it.
- **Anchored** — reads a declaration **but measures it against the tree or
  git**. `git diff "$(cat .headsign/tmp/base)"` reads git; what the agent
  supplied is the range. An untrue declaration does not survive the
  comparison, so an anchored check is stronger than the declaration it starts
  from and weaker than an unfakeable one, because everything it proves is
  proved *relative to* that declaration.

**An anchored check is anchored only while something guards its anchor**, and
that guard is a check of its own, placed **first in the gate** — checks run in
order and the first failure stops the gate, which is precisely where a guard
belongs. A gate whose anchor is unguarded is fakeable with one extra step and
must be reported that way. **The skill has to be able to say which tier each
gate it wrote is in**; a thin gate handed over unannounced is received as a
stronger promise than it is.

This is a different line from ADR-0007's, and the two meet rather than
compete. ADR-0007 sorts gates by *who authors the artifact a gate reads*, and
its measured row — nobody authors anything — is this line's unfakeable. What
is new here is the middle. ADR-0007 was answering how far a review verdict
can be trusted; this line answers what the workflow you have just written
actually promises, which is a question about every gate in it.

**5. Commands are verified by where they came from, which is a separate
axis.** A command lifted from the repository is checked for existence and not
run — running the suite is slow, and some gates are *supposed* to fail before
the work is done — with the hand-over saying plainly that CI is the evidence
and CI is not this machine. A command composed from a rule the repository
states only in prose (or only in its history) is run once, because nothing
anywhere is evidence that it even parses. **Mixing this axis with the tiers
is a real error**: a `git diff` predicate the agent composed is every bit as
unfakeable as `npm test`, and a `grep` of a file the agent wrote a second ago
is fakeable however respectable the Makefile target wrapping it looks.

**6. Revision is in scope, contents only.** The README's opening claims that
the shape of the work lives in a file and improves between runs; a tool that
helps only at the file's birth leaves half of that claim unserved, and
revision is the half that happens repeatedly. Deleting or renaming stays out:
a rename is not a design change, and it is the shortest path to breaking a
run, which goes looking for the exact path it recorded at `start`. Both
entrances — "what is a unit of work here" and "what about the current
workflow is not fitting" — rejoin at the same drawing, the same conversation,
and the same `validate`.

## The middle layer has two readers — a correction to ADR-0019

ADR-0019 §2 named `docs/workflow-reference.md` as the file for the moment you
write the graph. **That file is not on the writer's disk.** The plugin's
source is `./plugin` (`.claude-plugin/marketplace.json`), so what installs is
that directory: the two skills, `hooks/hooks.json`, the plugin manifest, and
the `dist/` bundle. The npm tarball is eleven files — `npm pack --dry-run` —
and not one of them is under `docs/`. Sending an agent to the
reference is therefore sending it to a URL, which is not what "install it and
it works" means.

**The seam was right. What was missed is that the middle moment has two
readers, and they are reached through different channels.**

- **A person** has the repository, or a GitHub page. They want one page that
  does not make them travel between how to write a workflow and how to run
  one, and they often read it while still deciding whether to adopt. That is
  `docs/workflow-reference.md`, unchanged.
- **An agent** has only what the plugin delivered, and it is reading at the
  moment it writes. It needs the writing half and nothing else. That is
  `plugin/skills/design-workflow/references/schema.md`, next to the skill
  that reads it.

The overlap — the field table, the routing form, the tokens `next` answers
with — stays in both on purpose. **This is the third time this design has
accepted the same shape of cost**: first between the README's prompt and the
skill, then between the two skills, now between the reference page and the
schema file. What makes it bearable here is what ADR-0015 built: the schema
is closed and pinned at `version: 0.1`, so a copy that has fallen behind
surfaces as a `validate` error in front of the person who hit it, rather than
as a quiet wrong answer.

Two ways of avoiding the duplication were rejected.

**Strip the writing material out of `docs/workflow-reference.md` and point at
the skill.** Rejected: a person evaluating headsign on GitHub could then no
longer see what a workflow file looks like without installing it. That is the
position ADR-0019 refused when it moved the vocabulary out of the README
instead of deleting it, and moving it a second time to somewhere unreachable
is the deletion it declined.

**Ship `docs/` inside the npm package.** Rejected: it reaches npm users only
and leaves plugin users exactly where they were, so the skill would still
need its own copy — and it adds a branch ("if you installed it this way, read
that file instead") to the one instruction that must not have a branch in it.

The correction is recorded here rather than written into ADR-0019 because the
second reader is a consequence of the decision above. There was no agent
reading at that moment until something was written to be read there; the
layer had one reader because it had one form.

## Alternatives considered

**Add the authoring procedure to the existing `workflow` skill.** One skill,
one place, no seam to explain to anybody. Rejected on the per-lap cost in §1
— 203 lines become roughly 900, paid on every lap of every run for material
needed once. There is a second cost: the description is how a skill gets
selected at all, so a single skill claiming both jobs has to describe both,
and the sharpest statement available ("writing the graph, not walking it") is
the one thing it could no longer say.

**Thicken the existing skill's note that a workflow can also be written.**
Cheapest of everything considered. Rejected: that note is aimed at someone
mid-run who wants a small edit and needs to know it is safe to make one, and
it is doing that job. The material here — a survey, a conversation with the
person, a verification pass, a hand-over that names each gate's tier — is not
a longer note. Growing it to fit would recreate the previous alternative one
paragraph at a time, and would leave the note's actual reader worse served.

**Drive the skill itself as a headsign run.** Rejected — **because it is
unnecessary, not because it is dangerous.** Two arguments had been used to
call it dangerous, and both turned out to be false against the code, which is
worth recording because they nearly settled the question on their own:

- *"An authoring run would break the run already going."* It does not. A
  second `start` while one is in progress leaves `state.json` exactly as it
  was and refuses, naming the phase the live run is on: ``a headsign run is
  already in progress (phase: <phase>). Run `headsign next` to continue, or
  `headsign abort` to stop it.``
- *"A workflow shipped with the plugin cannot be started without copying it
  into the user's `.headsign/`."* It can. `headsign start --workflow <path>`
  takes any path — a relative one outside `.headsign/` and an absolute one
  outside the repository both start, and `state.json` records the path
  verbatim.

With those gone, the decision was made on need: this is the machinery for
making workflows, and it does not have to be one. What that gives up is real
and is named in the Consequences.

**Share a single source with the README's paste-in prompt and test the two
for drift.** Rejected. It means re-cutting a README passage that had just
been through verification against three repositories (ADR-0019's
Consequences) into a frame and a body, and the behaviour that verification
established — that it refuses when there is nothing to gate on, that every
edge carries a command that exists — is exactly what a rewrite puts back in
question. The order between the two documents is defined instead: the skill
is the procedure for someone who has adopted headsign, and the prompt is that
procedure adjusted for someone who has not. The cost accepted is that nothing
detects drift between them.

## Consequences

- **The skill was run against three repositories, twice** — one with a full
  toolchain, one whose rules live only in prose, one holding nothing but
  Markdown; the same three ADR-0019's prompt was tested against. The first
  pass produced three working workflows **and seven defects in the
  instructions**. The second pass reproduced none of the seven, and returned
  a further set of findings, of which eight were fixed and four were declined
  with reasons.
- **The heaviest of the seven had deleted a check.** The comment rule was a
  closed list of three permitted kinds. In one repository a threshold chosen
  inside a check's own command — a description had to reach a certain length
  — had nowhere to state why that number, and rather than break the rule the
  agent dropped the check. A formatting rule had quietly moved a design
  decision. The rule is now a purpose, *write down what a reader cannot get
  from the file*, with the three kinds as a floor rather than a ceiling; on
  the second pass the same repository kept the same threshold check, with its
  reason above it.
- **The three tiers exist because a two-valued split broke in the same place
  in all three repositories.** Each of them independently wrote a check that
  read both the tree and a declaration the run had made, and one reported it
  back as a third category of its own. This arrived as a report because the
  instructions ask the agent to report defects in the instructions — the
  alternative was three workflows that looked fine and a classification that
  was wrong.
- **The refusal branch has not fired in the field.** Checks on the artifact a
  step is supposed to produce are part of the material the skill counts, so a
  repository holding nothing but structured files can still have predicates
  composed for it: the Markdown-only repository got eleven, and running them
  turned up a real bug in one of them. The skill's refusal is therefore
  narrower than the README prompt's, whose step 1 offers only repository
  commands and prose rules. The two documents can therefore give different
  answers about the same repository, and that is not a contradiction to
  resolve: the moments differ — deciding whether to adopt, versus building
  the thing.
- **The procedure that produces headsign's input is not itself gated.**
  Nothing structural stops an agent from skipping the survey, or from
  finishing without ever running `validate`; what stands there is instruction,
  which is what ADR-0007 calls discipline rather than enforcement. This tool's
  own advice — replace a self-report with an exit code — is deliberately not
  applied to the act of writing a workflow.
- **`docs/workflow-reference.md` now says which reader it is for**, and names
  the agent's copy that ships with the plugin. That sentence is the only edit
  the reference needed; its content was never the problem, and neither was
  ADR-0019's seam.
