# headsign

[日本語](README.ja.md) · [npm](https://www.npmjs.com/package/headsign)

[![npm version](https://img.shields.io/npm/v/headsign)](https://www.npmjs.com/package/headsign)
[![CI](https://github.com/meganemura/headsign/actions/workflows/ci.yml/badge.svg)](https://github.com/meganemura/headsign/actions/workflows/ci.yml)

> A headsign is the destination display on the front of a train. This one is
> for agent loops. In each iteration, the agent asks where it may go. headsign
> runs the gates and answers: proceed, retry, or terminus.

**headsign is a tiny phase gate for coding agents.** Your agent does the work
and keeps the conversation. headsign holds the run's state and decides whether
the work may move to the next phase. An agent needs one rule: **do the work,
run `headsign next`, and obey the first line of the answer.**

It holds only that decision. headsign does not define your phases or how the
agent completes a phase. If the agent wants to hand a step to three
subagents, or run two things at once, that is its call to make, not this
tool's to grant. You or the agent can rewrite
the workflow file between runs. Better judgment about agent work will improve
that file, and judgment about how to shape agent work is getting better
quickly on the agent's side of the line. The loop your agent designs for
your repository beats the one a harness author guessed at from outside it. A harness
that encodes today's answer would limit later improvements. You can change the
graph while the tool stays stable.

## TL;AR — Too Long; Agents Read.

A picture based on your repository can help you decide whether you need
headsign. Paste the block below into your coding agent. The agent reads the
repository, works out the phases itself, draws the loop, and stops there. It
runs nothing, installs nothing, and changes no file.

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

If the answer says "there is nothing here to gate on", believe it. That answer
is more useful than a diagram.

## Why

An agent will tell you a job is finished when it isn't. Not out of malice:
a model ending its turn has no way to check itself. It can say "implemented it, tests should pass"
whether the tests pass or fail. Later work then depends on that claim. headsign
replaces the claim with an exit code.

**The transition is not the agent's to declare.** When the agent asks where
the work goes
next, headsign runs the phase's checks. These checks are ordinary shell
commands that you wrote. Their exit codes determine the answer. An agent
cannot talk its way past a failing gate, because nothing it says is read.
One honest caveat comes with that: a check can read LLM-authored content,
such as a review verdict. That boundary is named, not hidden — see
[What headsign is not](#what-headsign-is-not) and
[ADR-0007](docs/adr/0007-verdict-authorship.md).

## Install

In Codex CLI, as a plugin:

```
codex plugin marketplace add meganemura/headsign
codex plugin add headsign@headsign
```

Codex requires a separate trust review for plugin hooks. After installation,
open `/hooks`, review the two commands, and trust them. The backstop can then
run. One thing in them looks wrong and is not: the plugin's own directory
arrives in `CLAUDE_PLUGIN_ROOT`. Codex defines that name. Its first-party plugin also uses
the name to register hooks.
[ADR-0028](docs/adr/0028-codex-as-a-second-principal.md) records the
measurement and explains why the bare `PLUGIN_ROOT` stays unchanged.

In Claude Code, as a plugin:

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

Both hosts receive the same four things. They receive the bundled CLI (no npm
install, no build) and a `workflow` skill for the loop discipline. They also
receive a `design-workflow` skill that writes the YAML with you. Stop-boundary
hooks prevent an agent from silently quitting mid-run.

Codex documents `cwd`, `session_id`, `Stop`, and `SubagentStop` in its hook
contract, so the backstop runs on both hosts. The research did not confirm a
stable public session variable for ordinary Codex CLI commands. Thus, headsign
cannot stamp `last_drive.session` during Codex `start` or `next` calls. On an unclaimed
Codex run with no existing stamp, every matching session can receive the
backstop. `HEADSIGN_OBSERVER=1` remains the explicit read-only opt-out.

A repository can enable it for everyone who opens it. Team members then do not
install it individually. Commit the following `.claude/settings.json`:

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
marketplace the repository expects and the plugin it wants enabled there.
Claude
Code defines how it handles that declaration for each person. Its documentation
describes that behavior.

Anywhere else — another agent, a custom harness, or your own hands at a
terminal — install the CLI:

```
npm install -D headsign
npx headsign --help
```

The CLI is the tool, and the plugin packages it. Both forms use a Node program.
The plugin removes the install and build steps, but it still needs the runtime.
Node ≥ 20 must exist wherever `headsign` runs. This requirement includes a CI
job or a harness in a Ruby, Go, or Python repository. The following guide
explains how to teach another agent the discipline and install the hook
backstop without the plugin. It also covers release tags, opt-outs, and updates
for the repository-wide declaration:
[docs/workflow-reference.md](docs/workflow-reference.md).

## What a loop looks like

This repository runs headsign on itself. One workflow checks each module in
`src/`. A writer explains the module to a middle-school reader. A judge who
cannot see the code checks the explanation. After three failed attempts, the
workflow records a design finding instead of a writing failure. The subject
is unusual, and the shape below is the point:

```
  inventory ──> explain ──> judge ─┬─ approved ──────────────> record
                    ↑              ├─ 3rd try, a module ─────> descend
                    │              ├─ 3rd try, a function ───> record
                    │              └─ otherwise ─────────────> explain
                    └──────────────  descend, once its parts are queued

  record ─┬─ queue not empty ──> explain
          └─ queue empty ─────> learn ──> improve ──> report ──> end
```

Each edge uses a shell command's exit code. The branch from `judge` uses
`grep -qx APPROVED .headsign/tmp/verdict`. The branch from `record` asks the
queue file whether another item remains. The following complete run comes from
this repository:

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

This run completed one item in three minutes and gained approval on the first
attempt. It did not take the rework edge. `a=0` shows that each phase had zero
failed attempts. For each transition choice, the log records the matching
command (`routed-when=`). It records `routed-default` when no command matches.
The log records the run's history as it happens and gives the reason for each
route.

The picture's job is to show the shape, not the subject. The prompt above
draws a picture for your repository.

The practice has names now — [*loop
engineering*](https://addyosmani.com/blog/loop-engineering/) for the cycle,
[*graph
engineering*](https://www.drjoshcsimmons.com/writing/we-are-entering-the-graph-engineering-phase)
for the shape it runs on. headsign is neither framework. It does
not run your agent or execute the graph. It keeps one file that states where
the work may go next. It answers when the agent asks. In graph engineering, an
edge carries typed state from one node to another. That graph can fan out and
join. In headsign, an edge carries nothing, an exit code selects one edge, and
the workflow does not fan out.

## What the machine holds

The phase file is small, and its schema is still pre-1.0. Therefore,
[docs/workflow-reference.md](docs/workflow-reference.md) defines the syntax.
That file can receive corrections. A copy here would remain in npm caches and
forks. Before you write the file, learn these stable limits:

- **One phase is running at a time.** Two phases never advance at once.
- **A shell exit code decides the transition**, never the agent's account of
  its work. The check is an ordinary command, such as `bundle exec rspec`,
  `go test ./...`, or `npm test`. headsign runs it as you would.
- **You can branch, and the run takes one edge.** A branching phase picks
  exactly one destination out of the ones written in the file, and cannot
  name one that isn't there.
  There is no join. Nothing forks or waits.
- **A phase's failures can be capped.** When the cap runs out, the run stops
  and gives the decision and its reason to a person.

Run state lives in a file next to the workflow. Therefore, a loop survives
context compaction. Run `headsign next` again to recover it. The state file
belongs to the directory where the run started. Separate clones and worktrees
never share a run. For two sessions in the same directory, the following
guide defines who drives and who only watches:
[Multiple sessions](docs/workflow-reference.md#multiple-sessions).

For parallel work, compose the work one level above headsign: one worktree,
one run. A shell script, a CI job, or your orchestrator can
distribute and collect the work. A parent headsign run can also read the child
run results with a gate. That layer stays yours. headsign holds one run and
will not be growing into it. See
[What headsign is not](#what-headsign-is-not) for the costs of this limit.

None of this displaces your CI. A gate usually runs the same commands as CI.
headsign runs them in each phase of the local agent loop before the pull request
arrives.

## Reading a finished one

After you have a picture, [example.headsign/](example.headsign/) provides
workflows for several work shapes. They cover a test-first feature, a bug fix
that must reproduce before its fix, docs, and a release with a human go/no-go.
They also cover a router for request kinds and a sweep that processes one queue
item per lap. The test-first workflow runs spec → red → green → refactor →
review. The spec gate requires a written spec with an acceptance section. The
red gate passes only while the new test still *fails*. The green gate uses the
suite. The refactor gate adds lint to the suite. The review gate reads a
verdict file. A rejection routes back to green. After at most three rounds, the
run goes to a person.

Read the workflow that is closest to your picture. It is there to check your
design against something that runs, not to be the thing you start from. A
workflow you adopt before you have decided the shape of your work lets the
harness decide it for you.

This repository's own workflows live in `.headsign/`. They stay separate from
the examples because they read this project's paths and tooling.

## What headsign is not

Read these design boundaries before you adopt headsign.

- **It doesn't verify quality by itself.** A gate proves whatever its check
  proves. Test gates are hard: their outcome cannot be authored. Review
  gates are soft because an LLM writes the verdict file. headsign guarantees a
  deterministic *transition*. It does not guarantee a wise verdict.
  [ADR-0007](docs/adr/0007-verdict-authorship.md) defines the hardness scale and
  explains how to keep the verdict away from the working agent when necessary.
- **It doesn't orchestrate.** One active phase per run: no DAGs, no parallel
  phases, no worktree management, and no provider abstraction. It provides no
  personas, template or expression language, MCP server, TUI, or cross-run
  dashboard. A run can work in a worktree without managing worktrees. Each run
  that starts in a worktree stays independent. You must set up those worktrees,
  start the child runs, and clean them up. If the harness needs to be clever,
  the cleverness is in the wrong place.
- **It doesn't run your agent.** Unlike outer-loop runners that invoke the
  model as a subordinate, headsign answers your agent's question. It starts no
  process and holds no session.
- **It doesn't force anyone to use it.** Nothing makes an agent or a teammate
  run `headsign start`, and skipping the tool leaves no trace. What the machine
  holds, it holds only from the moment a run begins. Making the loop a habit
  is convention work headsign cannot do for you.
- **It doesn't run on native Windows.** Checks execute via `/bin/sh` (POSIX);
  WSL works fine.

One more thing it is not: trusted input. headsign executes a workflow's
check commands on your machine, exactly like a Makefile target or an npm
`postinstall` script. A `.headsign/` directory you didn't write — cloned, or
arriving on a teammate's pull request — deserves the reading you would give
any other executable code in the repository.

headsign mechanically holds transitions and attempt accounting that an agent
cannot sweet-talk, and run state that survives compaction. After
a run starts, a backstop returns an agent to the loop when its turn ends
mid-run. An agent that walks away regardless leaves a line in the log
instead of silence. A read-only
`headsign status` is there for anyone who only wants to look.

### Where it sits among neighbors

**Curated skill packs** (Superpowers and similar tools) provide polished, fixed
workflows. headsign provides the gate machinery. You provide a workflow for
your repository or select one from
[example.headsign/](example.headsign/).

## Development

```
npm install
npm test          # node:test, no framework
npm run typecheck
npm run build     # esbuild → plugin/dist/headsign.mjs (committed artifact)
```

Node ≥ 20 is required to run headsign. Node ≥ 22.6 is required for development
because tests run TypeScript natively. [docs/](docs/README.md) contains the
design, each design decision, and the release procedure.

## License

MIT
