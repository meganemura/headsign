# ADR-0019: The README is the page before you enter — documentation splits into three layers

- Status: accepted
- Date: 2026-07-29

## Context

`README.md` had reached 970 lines and 49KB. It grew by accretion and the
rule it grew by was consistent: every mechanism that earned an ADR also
earned a README section. Routing, the router pattern, async review, the
backstop, multi-session runs, `status`, `claim`, environment variables,
nodes and edges — each was added because the mechanism was real and the
README was where things went.

The result is a file addressed to nobody in particular. A first-time reader
opens it to answer two questions — *what is this, and do I need it* — and
finds twenty sections written for someone who has already decided and is now
writing YAML. Meanwhile the agent that is actually driving a run does not
read the README at all; it reads `plugin/skills/workflow/SKILL.md`. The
longest document in the repository was the one with the fewest readers.

Underneath that is a distribution fact that no single file can satisfy on
both sides. `SKILL.md` ships with the plugin and is replaced whenever the
plugin updates (ADR-0005: plugins install straight from git, with the bundle
committed). The README does not update: it freezes in the registry's copy of
each published version, in every fork, and in every clone nobody pulled.
Anything about *how to conduct a run* that lives in the README is discipline
that outlives its own correction. But the mirror-image move — simply
deleting the YAML material from the README — takes away the only page an
author has at the moment they write a workflow file. `SKILL.md` is the
discipline of a run in flight and `docs/architecture.md` is the module map;
neither one teaches the vocabulary.

Two other things in the old README are worth naming, because both are the
same mistake pointed in different directions. The fit assessment ("Should
you adopt it? Let your agent decide") asked an agent to grade a repository
and hand back High/Medium/Low — a judgment with nothing under it. And the
Quick start opened with a `curl` that downloads a finished workflow, which
makes the first step of using a tool built on "design your own phases"
be *take ours*.

## Decision

**1. The README's job is the page before you enter, and both readers stay.**
What this is, whether you need it, where the machine's edges are, and a
prompt you can paste. It is written so a first-time human gets their
bearings from the prose alone, and so a reader who wants to go further can
hand the prompt to their own agent and get a picture of their own repository
back. The README stays short; the depth each reader needs is supplied by the
agent, not by the file.

**2. Three layers, one per moment.**

| Moment | File | Holds |
|---|---|---|
| Before you enter | `README.md` | what it is, whether you need it, the boundaries, the prompt |
| While you write the graph | `docs/workflow-reference.md` (new) | the YAML vocabulary and the CLI in detail |
| While it runs | `plugin/skills/workflow/SKILL.md` (unchanged) | the discipline of a run |

The seam is drawn on the distribution fact above, not on taste: **what
changes fastest goes where updates actually reach.** Operating discipline
rides the plugin channel; the reference is version-controlled documentation
a reader reaches deliberately; the README holds only what stays true after
it freezes.

**3. The README hands over boundaries, not syntax.** No `phases:`, no
`gate:`, no `on_pass:` — no YAML code block at all. What it states instead
is the shape of the machine:

- exactly one phase is running at any time; two never advance at once;
- the transition is decided by a shell exit code, not by what the agent says;
- branches are allowed, one edge is taken, and there is no join that waits;
- repeated failure of a phase can be capped, and exhaustion goes to a human.

Syntax is versioned and moving — the schema is `0.1` and ADR-0015 tightened
it recently. Boundaries are what headsign *is*, and they do not move; a
frozen copy of them is still true, where a frozen copy of the syntax is a
lie in someone's fork. Drawing a loop needs the boundaries and does not need
the syntax, which is what makes the split possible at all. The escape hatch
for wanting parallelism (one worktree, one run, joined a level above) stays,
because it is a boundary too.

**4. The demonstration is a prompt that draws a falsifiable picture, and
stops there.** It has the reader's agent read the repository, design the
phase split itself, draw the loop, and halt — read-only, no `headsign
start`. Running is too heavy a commitment for a first look, and the picture
is already enough to decide on.

Two requirements make the picture answerable rather than decorative:

- **every gate in it is bound to a shell command the reader can run.** Where
  the repository already has that command — a `package.json` script, a
  Makefile target, a line in the CI definition — it is copied literally.
  Where the repository states a rule only in prose ("never commit a secret")
  and the agent had to build a one-liner for it, the picture says so. The
  agent runs nothing and edits nothing either way; the reader is told which
  lines to check against the repository and which to check by running them.
- **if the repository has no mechanically provable signal** — no tests, no
  type check, no lint, no build — **the prompt says to report that instead of
  drawing.**

The first is a matter of consistency: headsign's whole claim is that a
transition is not the LLM's to declare (ADR-0001, ADR-0007). A README demo
consisting of a plausible LLM drawing would put on the marquee the exact
class of artifact this tool exists to distrust. The second is not an extra
rule but the consequence of the first — an agent told to draw a loop will
always draw *something*, and with no real commands to bind, no picture can
satisfy the requirement. Because that is now the answer, the separate fit
assessment is retired: **whether a picture comes out is the verdict**, and it
comes with the command inventory attached instead of a letter grade.

The picture's format is not specified — mermaid or ASCII, either is
accepted; only its content is required. The README's own example is ASCII, so
most agents will follow, and the ones that find a better drawing are not in
violation of anything.

**5. The worked example is headsign's own loop, with its own log.** An ASCII
drawing of `.headsign/fitness.yaml` and, under it, real lines from
`.headsign/log` — including the `routed-when=` line where the branch actually
bent. Lines may be trimmed, visibly, but never invented. Having just
required a falsifiable picture, a README whose own example was fictional
would be arguing against itself in the same screen. The subject is admittedly
peculiar — a loop that explains its own source and judges the explanation
(ADR-0016) — so the README says outright that the drawing is there for the
*shape*, not the subject; the reader's own shape comes from the prompt.

**6. The names come after the picture, and headsign stands beside them.**
*Loop engineering* and *graph engineering* appear immediately after the
example, never at the top. ADR-0016 named the way an explanation gets gamed:
restating a hard clause in harder words, which hides complexity instead of
finding it. Opening a README with a coinage is that move, and it would have
the README break the rule the fitness function enforces on `src/`. Naming
something the reader has already seen does not.

Standing beside them is also the accurate position. *Graph engineering* is
current mostly in a LangGraph-shaped sense, where the graph is a set of nodes
a framework executes; headsign's graph is a file it never executes. And the
usual sense of *loop engineering* — machinery that prompts an agent on your
behalf — points the other way round from this tool, which is called by the
agent and calls nothing. Borrowing the recognition while declining membership
costs nothing, because here **stating the difference is the differentiation**.

**7. No line budget for the README.** Length is decided by what has to be
said, judged by reading it. ADR-0016 retired `src/`'s 500-line budget after
recording that it never once stopped a proposal; a repository that threw out
that number has no standing to govern its README with a new one. What
replaces it is what replaced the budget: a question with an address — can a
first-time reader say what this is and whether they need it.

**8. `example.headsign/` is a mirror, not a starting line.** The reference to
it moves *after* the drawing, framed as "read the closest real one to what
you just drew", and the `curl` is deleted. Placed first it is a template and
the harness chooses the shape of the work; placed after the reader's own
design, the same directory is a reference to check that design against. The
file did not change — only where the reader meets it.

**9. `docs/` gets one door.** `docs/README.md` indexes architecture, ADRs,
maintenance, and the new workflow reference, and the README links to that one
page rather than to four.

## Alternatives considered

**Make the README agent-only** — a paste block and little else, on the
grounds that agents are the real readers. Rejected. The prompt exists to help
a *person* decide; it is not a device for taking the README away from people.
Whoever is evaluating this tool is human, and a README that answers only when
relayed through an agent makes evaluating the tool require the thing being
evaluated. It is also §4's objection applied to the whole file: the first
impression of a tool that distrusts LLM accounts would be delegated entirely
to an LLM account.

**Fold the reference material into `SKILL.md`** — one fewer file, and it
rides the update channel that actually reaches people. Rejected. `SKILL.md`
is the discipline of a run in flight, and it is loaded as context on every
run; adding the full YAML vocabulary charges every run for a document needed
only while a workflow is being *written*. The two moments have different
readers doing different things, which is the same reason layer 2 and layer 3
are separate at all. The seam in §2 is between moments, and this alternative
merges two of them to save a file.

**Delete the material instead of moving it** — the README shrinks and there
is nothing new to maintain. Rejected. It removes the only written account of
the workflow vocabulary. ADR-0003 fixes that vocabulary and ADR-0015 makes an
unknown key a hard error with no did-you-mean guess; a strict schema with no
reference page is a trap, and an author's first typo becomes an exit 3 with
nowhere to look. A missing document is not a shorter README, it is a broken
one.

**Keep the long README and add a table of contents** — by far the cheapest.
Rejected because it treats a navigation problem when there are two other
problems. It does not stop a frozen README from teaching operating
discipline that has since been corrected, and it does not get the first-time
reader to their two questions any faster — they still have to guess which of
twenty sections was written for them. ADR-0018 rejected its own version of
this ("leave the code and fix the map") on the same ground: writing an index
over the wrong arrangement is cheap to *write*, which is not the same as
cheap.

## Consequences

- **The README stops being where mechanisms get documented.** A new mechanism
  goes to the reference, to `SKILL.md`, or to an ADR; the README changes only
  when a boundary changes or the claim changes. That is now the test for
  whether a proposed README edit belongs there.
- **The most load-bearing block in the README is executable.** The prompt is
  the only part whose wording changes what readers get back, so it is kept in
  English in both `README.md` and `README.ja.md` — one block, with a single
  appended line telling the agent to answer in the user's language. Two
  translations would drift, and the drift would silently change the output
  for one set of readers. (The Japanese README is re-cut in a follow-up
  change.)
- **Part of this is mechanically checkable and part is not.** That the README
  contains no YAML block, no `curl`, and no dead relative link can be
  asserted by a command. Whether a first-time reader gets their bearings
  cannot; that stays a reading, done deliberately rather than pretended away.
- **The prompt was run against three repositories before this was accepted,
  and two of its instructions did not survive.** A repository with real
  signals produced a picture whose gates carried measured runtimes; a
  repository of Markdown and nothing else refused to draw, naming the two
  near-signals it had rejected. But *none of the three had a merged pull
  request* — step 2 asked for evidence that did not exist, and each agent
  quietly substituted the commit history — and a repository whose rules lived
  in prose produced a picture two-thirds of whose commands the agent had
  composed rather than found, marking them as composed of its own accord.
  Both instructions now say what the agents were already doing. A prompt is
  the one part of a README that can be tested rather than reviewed, and it
  should be, because reading it does not reveal the assumption it makes about
  every repository it will be pasted into.
- **The worked example carries upkeep.** It is real output from a real run,
  so when `fitness.yaml`'s shape changes the drawing and the log go stale
  together — and the fix is to re-cut both from another real run, not to edit
  the lines until they match. That cost is the price of §4 applying to the
  README itself.
- **The neighbor comparison shrinks to one contrast** (curated skill packs),
  and the acknowledgement to takt leaves the README with it. takt is still
  named in ADR-0001's Context, as the heavy pole this project began by
  finding too heavy for everyday use — which is the durable place for where
  the design came from; a comparison list in a README ages into a claim about
  somebody else's tool that nobody re-checks.
