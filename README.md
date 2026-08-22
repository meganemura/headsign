# headsign

[日本語](README.ja.md) · [npm](https://www.npmjs.com/package/headsign)

[![npm version](https://img.shields.io/npm/v/headsign)](https://www.npmjs.com/package/headsign)
[![CI](https://github.com/meganemura/headsign/actions/workflows/ci.yml/badge.svg)](https://github.com/meganemura/headsign/actions/workflows/ci.yml)

> A headsign is the destination display on the front of a train. This one is
> for agent loops: each iteration, the agent asks where it's bound; headsign
> runs the gates and answers — proceed, retry, or terminus.

**headsign is a tiny phase gate for coding agents.** Your agent does the work
and keeps the conversation; headsign holds the run's state and decides whether
the work may move to the next phase. The whole discipline an agent needs fits
in one sentence: **do the work, run `headsign next`, and obey the first line of
the answer.**

It holds that one decision and deliberately nothing else. headsign has no
opinion about what your phases are, and none about how the agent gets a phase
done: if it wants to hand a step to three subagents, or run two things at once,
that is its call to make, not this tool's to grant. The shape of the work lives
in a file you can rewrite between runs — by hand, or by the agent — and that is
where the improvement is going to come from. Judgment about how to shape agent
work is getting better quickly, and it is getting better on the agent's side of
the line: the loop your agent designs for your repository will beat the one a
harness author guessed at from outside it. A harness that encoded today's
answer would become the ceiling. So the graph is yours to change, and the tool
it asks stays still.

## TL;AR — Too Long; Agents Read.

Whether this is for you is easier to judge with a picture of your own
repository in it. Paste the block below into your coding agent. It reads the
repository, works out the phases itself, draws the loop, and stops there —
it runs nothing, installs nothing, and changes no file.

```text
You are looking at a repository. I am considering headsign, a phase gate for
agent work: an agent does the work, then asks a small CLI whether the work may
advance to the next phase, and the answer comes from shell exit codes rather
than from the agent's own report.

Design what that loop would look like *here*, and draw it. This is a read-only
reading of the repository: run nothing, install nothing, change no file.

1. Inventory the mechanical signals this repository already has — commands that
   can prove something about the state of the work. Look wherever this project
   keeps them: package.json scripts, Rakefile or Makefile targets, CI workflow
   definitions, and the contributing docs. Write down the exact commands, and
   roughly how long the slowest takes. Separately, note any rule the repository
   states only in prose — "never commit a secret", "every migration is
   reversible" — that a shell one-liner could decide. Those are commands nobody
   has written yet, and you may have to write them.

   If there is nothing here a shell command can judge — no tests, no type
   check, no lint, no build — stop and say so, and do not draw a loop. Without
   a mechanical signal there is nothing for a gate to hold, and a picture drawn
   anyway would be a guess wearing the clothes of a design.

2. Read the recently merged pull requests (skip dependency bumps and chores)
   and work out the typical unit of work here. If there are no merged pull
   requests — plenty of repositories commit straight to the main branch — read
   the recent commit history instead; it is the same evidence kept elsewhere.
   Split that unit of work into phases yourself — as many as it takes, usually
   two to five — each ending in something a command can check.

3. Draw the loop. Any notation you like; ASCII or mermaid is fine. It has to
   show:
   - every phase, and the edges between them;
   - on each edge, the shell command whose exit code decides it. Where the
     repository already has that command, copy it literally. Where you built
     one out of a rule the repository only states in prose, write it out and
     mark it as composed — I need to know which lines to check against the
     repository and which to check by running them. Either way, running it is
     how I find out whether you were right;
   - the edge taken when a gate fails and the work goes back for rework;
   - one branch: a point where the run picks one of several destinations, and
     the shell command that picks.

   Rules the picture has to obey. Exactly one phase is active at a time.
   A branch takes exactly one of the edges written down, and there is no join:
   nothing fans out and nothing waits. A phase's failures can be capped, and
   when the cap runs out the run stops and asks a person.

4. Under the picture, list what in that unit of work no shell command can
   judge — a design call, a UX decision — and say, for each, whether it should
   be sliced into something checkable, carried by a review phase whose gate
   reads a verdict file, or left to the human reviewing the pull request.

Stop at the picture. Do not install headsign and do not start a run.

Reply in the language the user is speaking.
```

If the answer comes back "there is nothing here to gate on", believe it. That
is the answer, and it is worth more than a diagram.

## Why

An agent will tell you a job is finished when it isn't. Not out of malice: a
model ending its turn has no way to check itself, so "implemented it, tests
should pass" is the same sentence whether they pass or not — and everything
downstream is built on that sentence. headsign replaces it with an exit code.

**The transition is not the agent's to declare.** When the agent asks where the
work goes next, headsign runs the phase's checks — ordinary shell commands you
wrote — and the answer follows from what they exit with. An agent cannot talk
its way past a failing gate, because nothing it says is read. One honest caveat
comes with that: what a check *reads* can still be LLM-authored (a review
verdict, say). That boundary is named, not hidden — see
[What headsign is not](#what-headsign-is-not) and
[ADR-0007](docs/adr/0007-verdict-authorship.md).

## Install

In Codex CLI, as a plugin:

```
codex plugin marketplace add meganemura/headsign
codex plugin add headsign@headsign
```

Codex requires a separate trust review for plugin hooks. Open `/hooks` after
installation, review the two commands, and trust them before expecting the
backstop to run. One thing in them looks wrong and is not: the plugin's own
directory arrives in `CLAUDE_PLUGIN_ROOT`. Codex defines that name, and Codex's
own first-party plugin registers its hooks with it —
[ADR-0028](docs/adr/0028-codex-as-a-second-principal.md) records the
measurement and why the bare `PLUGIN_ROOT` is left alone.

In Claude Code, as a plugin:

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

Both hosts receive the same four things: the bundled CLI (no npm install, no build), a
`workflow` skill teaching the loop discipline, a `design-workflow` skill that
writes the YAML with you, and the stop-boundary hooks that keep an agent from
silently quitting mid-run.

Codex documents `cwd`, `session_id`, `Stop`, and `SubagentStop` in its hook
contract, so the backstop runs on both hosts. This research did not confirm a
stable public session variable for ordinary Codex CLI commands. Thus, headsign cannot
stamp `last_drive.session` during Codex `start` or `next` calls. On an unclaimed
Codex run with no existing stamp, every matching session can receive the
backstop. `HEADSIGN_OBSERVER=1` remains the explicit read-only opt-out.

A repository can enable it for everyone who opens it, so that nobody on the team
installs it individually. That is a committed `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "headsign": {
      "source": { "source": "github", "repo": "meganemura/headsign" }
    }
  },
  "enabledPlugins": { "headsign@headsign": true }
}
```

Those keys are a declaration rather than an installation: they name the
marketplace the repository expects and the plugin it wants enabled there. What a
given person's Claude Code does on meeting that declaration is Claude Code's to
define and its own documentation's to describe.

Anywhere else — another agent, a custom harness, or your own hands at a
terminal — install the CLI:

```
npm install -D headsign
npx headsign --help
```

The CLI is the tool; the plugin is packaging. Either way it is a Node program:
the plugin spares you the install and the build, not the runtime, so Node ≥ 20
has to be present wherever `headsign` is invoked — including a CI job, or a
harness in a Ruby, Go, or Python repository whose toolchain is otherwise none
of Node's business. Teaching another agent the discipline, installing
the hook backstop without the plugin, and the parts of that repository-wide
declaration that move — pinning it to a release tag, opting out of it, and what
updating means — are in
[docs/workflow-reference.md](docs/workflow-reference.md).

## What a loop looks like

This repository runs headsign on itself. One of its workflows sweeps the
modules of `src/` and asks, of each, whether it can be explained to a
middle-school reader by a writer who then has to face a judge that never sees
the code; anything that survives three attempts unexplained is filed as a
design finding rather than a writing failure. The subject is peculiar. The
subject is not the point — the shape is:

```
  inventory ──> explain ──> judge ─┬─ approved ──────────────> record
                    ↑              ├─ 3rd try, a module ─────> descend
                    │              ├─ 3rd try, a function ───> record
                    │              └─ otherwise ─────────────> explain
                    └──────────────  descend, once its parts are queued

  record ─┬─ queue not empty ──> explain
          └─ queue empty ─────> learn ──> improve ──> report ──> end
```

Every edge there is a shell command's exit code. The branch out of `judge` is
`grep -qx APPROVED .headsign/tmp/verdict`; the one out of `record` asks the
queue file, not the agent, whether another lap is owed. Here is a run of it,
whole, straight out of this repository:

```
$ tail -8 .headsign/log
2026-07-29T07:24:19+09:00 start inventory a=0 i=0 workflow=explainability-fitness
2026-07-29T07:24:19+09:00 advance explain a=0 i=1 from=inventory
2026-07-29T07:24:41+09:00 advance judge a=0 i=2 from=explain
2026-07-29T07:26:36+09:00 advance record a=0 i=3 from=judge routed-when="grep -qx APPROVED .headsign/tmp/verdict"
2026-07-29T07:26:36+09:00 advance learn a=0 i=4 from=record routed-default
2026-07-29T07:26:59+09:00 advance improve a=0 i=5 from=learn
2026-07-29T07:27:12+09:00 advance report a=0 i=6 from=improve
2026-07-29T07:27:28+09:00 complete report a=0 i=7
```

Three minutes, one item, approved on the first attempt — so this particular run
never took the rework edge, and `a=0` says no phase ever spent a failed
attempt. Where a transition had a choice to make, the log records the command
that made it (`routed-when=`) or that no command matched and the default was
taken (`routed-default`). A run's history is written as it happens, and it says
why the run went this way rather than that one.

The picture's job is to show the shape, not the subject. The picture for your
repository is what the prompt above draws.

The practice has names now — [*loop
engineering*](https://addyosmani.com/blog/loop-engineering/) for the cycle,
[*graph
engineering*](https://www.drjoshcsimmons.com/writing/we-are-entering-the-graph-engineering-phase)
for the shape it runs on. headsign is neither framework: it doesn't run your
agent, and it doesn't execute the graph. It keeps one file saying where the
work may go next, and answers when the agent asks. The graph in that second
name is a different object as well — there an edge carries typed state from
one node to the next, and the shape fans out and joins, while here an edge
carries nothing, an exit code picks which one is taken, and nothing fans out.

## What the machine holds

The file the phases live in is small, and its schema is still pre-1.0 — so the
syntax is in [docs/workflow-reference.md](docs/workflow-reference.md), where it
can be corrected, rather than here, where copies of it freeze in npm caches and
forks. What is worth knowing before you write any of it is where the walls are,
because those don't move:

- **One phase is running at a time.** Two phases never advance at once.
- **A shell exit code decides the transition**, never the agent's account of
  what it did. The check is an ordinary command — `bundle exec rspec`,
  `go test ./...`, `npm test` — run the way you would run it yourself.
- **You can branch, and the run takes one edge.** A branching phase picks
  exactly one destination out of the ones written in the file, and cannot name
  one that isn't there. There is no join: nothing forks and nothing waits.
- **A phase's failures can be capped.** When the cap runs out, the run stops
  and hands the decision to a person, with its reason.

Run state lives in a file next to the workflow, so a loop survives context
compaction: recovery is just `headsign next` again. That file belongs to the
directory the run started in, which is also what answers the question of a team
working at once — separate clones and worktrees never share a run, and for two
sessions open on the same directory, who drives and who only watches is
[Multiple sessions](docs/workflow-reference.md#multiple-sessions).

When you do want work happening in parallel, compose it one level up — one
worktree, one run, and above them something that fans the work out and gathers
it back in: a shell script, a CI job, the orchestrator you already run, or a
parent headsign run whose gate reads whatever the child runs left behind. That
layer stays yours; headsign holds one run and will not be growing into it. What
that costs you is in [What headsign is not](#what-headsign-is-not).

None of this displaces your CI: the commands a gate runs are usually the ones
CI already runs, and headsign's part is to run them inside the local agent
loop, phase by phase, so that the pull request arrives having been through them
already.

## Reading a finished one

Once you have a picture of your own, [example.headsign/](example.headsign/)
holds workflows for several shapes of work — a test-first feature, a bug fix
that must reproduce before it may fix, docs, a release with a human go/no-go,
a router that dispatches by kind of request, a sweep that works a queue one
item per lap. To put one of them into words: the test-first workflow runs
spec → red → green → refactor → review, where spec's gate wants a written spec
with an acceptance section, red passes only while the new test still *fails*,
green and refactor both gate on the suite (refactor adding lint to it), and
review gates on a verdict file — a rejection routes back to green, three rounds
at most, after which the run goes to a person.

Read the one nearest to what you drew. It is there to check your design against
something that runs, not to be the thing you start from: a workflow you adopt
before you have decided the shape of your work lets the harness decide it for
you.

This repository's own workflows live in `.headsign/`, kept apart from the
examples because they read this project's paths and tooling.

## What headsign is not

Read this before adopting — the boundaries are the design.

- **It doesn't verify quality by itself.** A gate proves whatever its check
  proves. Test gates are hard: their outcome cannot be authored. Review gates
  are soft: the verdict file is written by an LLM, and what headsign guarantees
  is that the *transition* is deterministic, not that the verdict is wise. The
  hardness scale — and how to take the pen out of the working agent's hand when
  it matters — is [ADR-0007](docs/adr/0007-verdict-authorship.md).
- **It doesn't orchestrate.** One active phase per run: no DAGs, no parallel
  phases, no worktree management, no provider abstraction, no personas, no
  template or expression language, no MCP server, no TUI, no cross-run
  dashboard. Not *managing* worktrees isn't the same as not working in one — a
  run started in a worktree is entirely its own — but setting those worktrees
  up, starting the child runs, and cleaning up after them stays yours. If the
  harness needs to be clever, the cleverness is in the wrong place.
- **It doesn't run your agent.** Unlike outer-loop runners that invoke the
  model as a subordinate, headsign is a place your agent asks a question. It
  starts no process and holds no session.
- **It doesn't force anyone to use it.** Nothing makes an agent or a teammate
  run `headsign start`, and skipping the tool leaves no trace. What the machine
  holds, it holds only from the moment a run begins. Making the loop a habit is
  convention work headsign cannot do for you.
- **It doesn't run on native Windows.** Checks execute via `/bin/sh` (POSIX);
  WSL works fine.

One more thing it is not: trusted input. A workflow's check commands are shell
that headsign executes on your machine, exactly like a Makefile target or an
npm `postinstall` script. A `.headsign/` directory you didn't write — cloned,
or arriving on a teammate's pull request — deserves the reading you would give
any other executable code in the repository.

What it does hold, it holds mechanically: transitions and attempt accounting an
agent cannot sweet-talk, run state that survives compaction, a backstop that
takes effect once a run has started — an agent ending its turn mid-run is
pushed back to the loop, and one that walks away regardless leaves a line in
the log instead of silence — and a read-only `headsign status` for everyone who
only wants to look.

### Where it sits among neighbors

**Curated skill packs** (Superpowers and kin) ship polished, fixed workflows.
headsign ships the gate machinery, and you bring the workflow — drawn for your
own repository, or read off the shelf in
[example.headsign/](example.headsign/).

## Development

```
npm install
npm test          # node:test, no framework
npm run typecheck
npm run build     # esbuild → plugin/dist/headsign.mjs (committed artifact)
```

Node ≥ 20 to run; Node ≥ 22.6 to develop (tests run TypeScript natively). The
design, the record of every decision behind it, and the release procedure are
in [docs/](docs/README.md).

## License

MIT
