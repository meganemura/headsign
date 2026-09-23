# headsign

[![npm version](https://img.shields.io/npm/v/headsign)](https://www.npmjs.com/package/headsign)

> A headsign is the destination display on the front of a train. This one is
> for agent loops. In each iteration, the agent asks where it may go. headsign
> runs the gates and answers: proceed, retry, or terminus.

**headsign is a small harness that helps coding agents sharpen their own tools.**
The agent does the work and keeps the conversation. headsign holds the run's
state and runs shell checks to decide whether work can advance.
The driving rule is: **do the work, run `headsign next`, and follow its verdict.**

**Optimization by default.** New runs prompt the agent to assess the procedure
at completion or terminal escalation. The agent can improve a workflow,
repair a check, retain a useful method, or leave a consequential proposal.
An edit is optional; the opportunity to reconsider the method is built in.

The design bets on more capable future models. The model chooses the method
and judges which improvements matter. headsign supplies state, gate results,
and a bounded reminder. It does not invoke a model itself.
Prefer changes that improve later outcomes over convenient nearby edits.
A workflow can evolve within the user's objective and constraints, including
during a run through explicit acceptance of reported graph changes.

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

A completion report can omit a required check. Later work then depends on
a claim that has not been tested. headsign runs the phase's checks before
it records the transition. Better models can also improve those checks and
the procedure around them.

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

Codex requires a separate trust review for plugin hooks. After installation:

1. Open `/hooks`.
2. Review the three commands.
3. Trust the commands to activate workflow discovery and the backstop.

One thing in them looks wrong and is not: the plugin's own directory
arrives in `CLAUDE_PLUGIN_ROOT`. Codex defines that name. Its first-party plugin also uses
the name to register hooks.
[ADR-0028](docs/adr/0028-codex-as-a-second-principal.md) records the
measurement and explains why the bare `PLUGIN_ROOT` stays unchanged.

In Claude Code, as a plugin:

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

In Antigravity CLI (`agy`), as a plugin:

```sh
agy plugin install https://github.com/meganemura/headsign
```

(Or from within a cloned repository: `agy plugin install ./plugin`)

All three hosts receive the bundled CLI (no npm install or build), the
`workflow` skill, the `design-workflow` skill, the `optimize` skill, and lifecycle hooks.
On Antigravity, the `Stop` hook prevents premature agent termination while a workflow is running, and `PreInvocation` discovers unfinished workflows at session start.
Claude Code and Codex use SessionStart discovery and two stop-boundary hooks.

Claude Code also receives a run pane. It loads only where the session sets
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, the early-access flag for function
hooks. `/headsign` opens a pane beside the transcript that shows what
`headsign status` prints, and closes it again. The pane refreshes after a
`headsign` shell command and after each turn, and `headsign start` opens it.
The stop hooks stay shell hooks on both hosts
([ADR-0040](docs/adr/0040-the-run-pane-is-a-claude-only-overlay.md)).
The same module names the caller of each `headsign` shell command: a subagent
that runs `headsign next` is recorded as the run's driver at once, and it does
not need `headsign claim`
([ADR-0041](docs/adr/0041-a-command-that-names-its-caller.md)).

Codex documents `cwd`, `session_id`, `Stop`, and `SubagentStop` in its hook
contract, so the backstop runs on both hosts. The research did not confirm
a stable public session variable for ordinary Codex CLI commands. Thus,
headsign cannot stamp `last_drive.session` during Codex `start` or `next`
calls. On an unclaimed Codex run with no existing stamp, every matching
session can receive the running-run backstop. That nudge states that the
driver is unknown and tells a session that does not drive the run to avoid
`next`. The terminal optimization fallback requires positive attribution
and passes when that stamp is unknown. `HEADSIGN_OBSERVER=1` remains the
explicit read-only opt-out.

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

## Optimization by default

The bundled skills divide the work:

| Skill | Responsibility |
|---|---|
| `design-workflow` | Design or revise the workflow and its checks |
| `workflow` | Drive the current run and collect useful observations |
| `optimize` | Assess the procedure and apply or propose consequential improvements |

`workflow` and `design-workflow` are short entries. The long procedure sits in `references/` beside the entry and is opened when that entry names it. `optimize` is the whole skill.

New runs enable optimization by default. Use `headsign start --no-optimize`,
or add the option after a workflow name, to opt out for one run. At the first
repeated gate failure, headsign asks whether the work or the procedure needs
repair. At `COMPLETE` or terminal `ESCALATE`, it asks the responsible agent to
use the `optimize` skill. The assessment can retain the current method, apply
an authorized repair, record a proposal, or defer the work. It favors future
outcomes and consequential opportunities over edit counts.

The assessment directory is gitignored and survives later starts. Move useful
knowledge into reviewed workflow instructions, checks, or project documents.
An older run keeps its current state after an upgrade; optimization starts
with the next new run. Do not restart work just to enable it.

The assessment is a self-report. It does not prove that an improvement is
correct or authorized. A valid record lives at
`.headsign/optimization/<run-id>/assessment.md`. Its first line is
`NO_CHANGE`, `APPLIED`, `PROPOSED`, or `DEFERRED`, followed by a nonempty
explanation. Terminal notices can repeat until this record exists. The stop
hook requests at most one extra turn when it can identify the responsible
session or agent. Unknown identity leaves stopping unblocked, so the CLI
notice remains the guidance. Aborted runs, old runs, opt-out runs, pauses, and
observer sessions do not receive this fallback. For an explicit stop, the
skill records `DEFERRED` when possible. A nonempty stop note suppresses the
request for that stop. The hook cannot infer other stop intent from its input.

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
context compaction. On resume, run `headsign status`, read the current phase,
and complete its work before `headsign next` judges the gate. `RUNNING` reports
an unfinished run, not active agent processes. The authorized driver starts
any required delegated work. The state file
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

**Skill packs** provide reusable instructions for agents. headsign provides the gate machinery. You provide a workflow for
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
design, each design decision, and the release procedure. For a local Codex
plugin, see [Local plugin development](docs/maintenance.md#local-plugin-development).

## License

MIT

---

## Japanese

> 方向幕(ヘッドサイン)は、列車の前面に掲げる行先表示である。
> headsign は、エージェントループの方向幕だ。
> 周回のたびにエージェントが行き先を尋ね、headsign がゲートを実行して答える。
> 進むか、やり直すか、終点か。

**headsign は、エージェントが自分の道具を研ぎ続けるための、小さなハーネスです。**
エージェントが作業を進め、会話を主導します。
headsign は run の状態を保持し、シェルの検査で次のフェーズへ進めるかを判定します。
運転の規律は、**作業をしたら `headsign next` を実行し、その判定に従うこと**です。

**Optimization by default。** 新しい run では、完了時や run を終えるエスカレーション時に、手順の見直しを促します。
エージェントは workflow の改善、検査の修理、有用な方法の維持、影響の大きい提案の記録を選べます。
編集は必須ではありませんが、方法を考え直す機会が組み込まれています。

この設計は、未来のモデルがさらに賢くなることに賭けています。
方法を選び、どの改善に価値があるかを判断するのはモデルです。
headsign は状態、ゲートの結果、回数を限った働きかけを提供し、モデル自体は呼び出しません。
近くにある簡単な編集よりも、次の仕事の結果を良くする変更を優先します。
workflow はユーザーの目的と制約の範囲で変えられます。
実行中に報告されたグラフ変更も、明示的な受入れを経て適用できます。

## TL;AR — Too Long; Agents Read.

自分のリポジトリを描いた絵を見れば、headsign が必要かを判断しやすくなります。
下のブロックを、あなたのコーディングエージェントに貼ってください。
エージェントはリポジトリを読み、フェーズ分割を自分で考え、ループを描き、そこで止まります。
エージェントは何も実行せず、何もインストールせず、ファイルを一つも書き換えません。

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

「ここにはゲートを掛けられるものが無い」という答えが返ってきたなら、それを信じてください。
その答えには、図よりも値打ちがあります。

## なぜ

完了報告だけでは、必要な検査が抜け落ちることがあります。
後の作業は、まだ検証されていない主張に依存することになります。
headsign は遷移を記録する前に、そのフェーズの検査を実行します。
モデルの判断が良くなれば、その検査と周囲の手順も改善できます。

**遷移はエージェントが宣言するものではありません。**
エージェントが次の行き先を尋ねると、headsign はそのフェーズのチェック(あなたが書いた普通のシェルコマンド)を実行します。
headsign は、その終了結果から答えを出します。
落ちているゲートを言葉で通り抜けることはできません。
エージェントの言い分は一切読まれないからです。
これには正直な但し書きが一つ付きます。
チェックが*読む*ものは、依然として LLM が書いたものでありえます(たとえばレビューの判定)。
この境界は隠さず名指ししてあります。
[headsign がやらないこと](#headsign-がやらないこと)と [ADR-0007](docs/adr/0007-verdict-authorship.md) を参照してください。

## インストール

Codex CLI では、プラグインとしてインストールします:

```
codex plugin marketplace add meganemura/headsign
codex plugin add headsign@headsign
```

Codex は、プラグインの hook に個別の信頼確認を求めます。
インストール後に次の手順を実行します。

1. `/hooks` を開きます。
2. 三つのコマンドを確認します。
3. コマンドを信頼し、run の発見とバックストップを有効にします。

そのコマンドの中に、間違いに見えて間違いではないものが一つあります。
プラグイン自身の置き場が `CLAUDE_PLUGIN_ROOT` で渡されることです。
この名前は Codex が定義していて、Codex 自身の公式プラグインもこの名前で hook を登録しています。
実測の内容と、素の `PLUGIN_ROOT` を使わない理由は [ADR-0028](docs/adr/0028-codex-as-a-second-principal.md) にあります。

Claude Code では、プラグインとして:

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

Antigravity CLI (`agy`) では、プラグインとして:

```sh
agy plugin install https://github.com/meganemura/headsign
```

(クローン済みのローカルリポジトリ内からであれば、`agy plugin install ./plugin` でもインストールできます)

どのホストにもバンドル済み CLI(npm install もビルドも不要)、`workflow` スキル、`design-workflow` スキル、`optimize` スキル、ライフサイクルフックが届きます。
Antigravity では、ワークフロー実行中にエージェントが途中で停止するのを `Stop` フックが防ぎ、セッション開始時には `PreInvocation` フックが未完了のワークフローを発見します。
Claude Code と Codex は SessionStart による発見と二つの停止境界 hook を使います。

Claude Code には run pane も届きます。
これはセッションが `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` を設定しているときだけ読み込まれます。function hook の早期アクセス用フラグです。
`/headsign` は transcript の横に pane を開き、`headsign status` の出力を表示します。もう一度実行すると閉じます。
pane は `headsign` のシェルコマンドの後と各 turn の後に更新され、`headsign start` は pane を開きます。
停止 hook はどちらのホストでもシェル hook のままです([ADR-0040](docs/adr/0040-the-run-pane-is-a-claude-only-overlay.md))。
同じモジュールは、各 `headsign` シェルコマンドの呼び出し元を CLI に伝えます。
`headsign next` を実行した subagent はその場で run の駆動者として記録され、`headsign claim` は不要です([ADR-0041](docs/adr/0041-a-command-that-names-its-caller.md))。

Codex の hook 契約には、`cwd`、`session_id`、`Stop`、`SubagentStop` が明記されています。
そのため、バックストップは両方のホストで動きます。
Codex の通常の CLI コマンドで使える公開セッション環境変数は、公式資料で確認できませんでした。
そのため、Codex で `start` または `next` を実行しても、headsign は `last_drive.session` を記録できません。
既存の記録が無い未 claim の Codex run では、一致する各セッションに実行中の run のバックストップが働くことがあります。
その催促は駆動者が不明であることを伝え、run を駆動していないセッションに `next` を実行しないよう案内します。
終端の改善フォールバックには担当者の特定が必要で、記録が不明な場合は停止を妨げません。
読み取り専用の明示的な解除には、従来どおり `HEADSIGN_OBSERVER=1` を使います。

リポジトリの側で、そこを開く全員に対して有効にすることもできます。
そうすれば、チームの誰も個別にインストールせずに済みます。
それを担うのは、コミットされた `.claude/settings.json` です:

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

これらのキーはインストールではなく宣言です。
この宣言は、リポジトリが前提とするマーケットプレイスと、そこで有効にするプラグインを名指しするだけです。
各人の Claude Code は、この宣言に出会ったときの動作を決めます。
その動作は Claude Code 自身のドキュメントが説明します。

それ以外の場所、つまり別のエージェント、自作のハーネス、あるいはターミナルでの手作業では、CLI をインストールしてください:

```
npm install -D headsign
npx headsign --help
```

道具の本体は CLI で、プラグインはその包装です。
どちらにせよ中身は Node のプログラムです。
プラグインが省いてくれるのはインストールとビルドであって、ランタイムではありません。
そのため `headsign` を呼ぶ場所には、どこであれ Node 20 以上が必要です。
CI のジョブでも、ツールチェーンが本来 Node と無縁な Ruby / Go / Python のリポジトリのハーネスでも、これは変わりません。
別のエージェントに規律を教える方法と、プラグインなしで hook のバックストップを入れる方法は、[docs/workflow-reference.ja.md](docs/workflow-reference.ja.md) にあります。
同じ文書は、リポジトリ単位の宣言が担う動作(リリースタグへの固定、個人単位での解除、更新が何を意味するか)も説明します。

## Optimization by default

同梱する skills は、次の役割を持ちます。

| Skill | 責務 |
|---|---|
| `design-workflow` | workflow と検査を設計、改訂する |
| `workflow` | 現在の run を進め、有用な観察を残す |
| `optimize` | 手順を評価し、影響の大きい改善を適用、提案する |

新しい run では、改善の評価が既定で有効です。
一つの run で無効にするには、`headsign start --no-optimize` を使うか、ワークフロー名の後ろにこのオプションを付けます。
同じゲートが初めて繰り返し失敗すると、headsign は作業と手順のどちらに修理が必要かを尋ねます。
`COMPLETE` または終端の `ESCALATE` では、担当エージェントに `optimize` スキルの使用を求めます。
この評価では、現在の方法の維持、許可された修理、提案の記録、作業の延期を選べます。
編集数よりも、将来の結果と影響の大きい機会を優先します。

評価記録のディレクトリは Git 管理外で、次の run を開始した後も残ります。
有用な知見は、レビューした workflow の指示、検査、プロジェクトの文書へ移します。
アップグレードしても、古い run は現在の状態を保持します。
自動改善は次の新しい run から有効になるため、それを有効にする目的で作業を再起動しないでください。

評価記録は自己申告であり、改善の正しさや権限を証明しません。
有効な記録は `.headsign/optimization/<run-id>/assessment.md` に置かれます。
1 行目は `NO_CHANGE`、`APPLIED`、`PROPOSED`、`DEFERRED` のいずれかです。
2 行目以降には、空でない説明が必要です。
この記録ができるまで、終端の案内は繰り返されることがあります。
stop hook は担当セッションまたは担当エージェントを識別できた場合に限り、追加のターンを一度だけ要求します。
識別情報が不明な場合は停止を妨げず、CLI の案内だけを残します。
abort 済みの run、古い run、無効にした run、一時停止、observer session には、このフォールバックは働きません。
明示的に停止する場合は、可能ならスキルが `DEFERRED` を記録します。
空でない stop note は、その停止時の要求を抑止します。
hook は、入力に含まれない停止意図を推測できません。

## ループはどんな形か

このリポジトリは、headsign を自分自身に対して走らせています。
そのワークフローの一つは `src/` のモジュールを一つずつ掃引し、それぞれを中学生の読者に説明しきれるかを問います。
説明する側は、そのあとコードを一度も見ない審査役と向き合うことになります。
三度試しても説明しきれなかったものは、書き手の失敗ではなく設計上の指摘として記録されます。
特殊な題材よりも、形が要点です。

```
  inventory ──> explain ──> judge ─┬─ approved ──────────────> record
                    ↑              ├─ 3rd try, a module ─────> descend
                    │              ├─ 3rd try, a function ───> record
                    │              └─ otherwise ─────────────> explain
                    └──────────────  descend, once its parts are queued

  record ─┬─ queue not empty ──> explain
          └─ queue empty ─────> learn ──> improve ──> report ──> end
```

ここに描かれた辺は、すべてシェルコマンドの exit code です。
`judge` から出る分岐には `grep -qx APPROVED .headsign/tmp/verdict` を使います。
`record` から出る分岐は、もう一周するかをキューのファイルに尋ねます。
そのループを実際に回した記録を、このリポジトリからそのまま、丸ごと引いてきます:

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

一件を三分で処理し、一度目で承認されました。
そのためこの run は手直しの辺を一度も通っておらず、`a=0` はどのフェーズも失敗の試行を消費しなかったことを示しています。
遷移を選べる箇所では、遷移を決めたコマンド(`routed-when=`)がログに残ります。
どのコマンドも一致しなければ、既定を選んだこと(`routed-default`)が残ります。
run の履歴は起きるたびに書かれ、遷移を選んだ理由を示します。

この絵の役目は、形を見せることであって、題材を見せることではありません。
あなたのリポジトリのための絵は、TL;AR のプロンプトが描きます。

この営みには、いまでは名前がついています。
周回のほうは [*loop engineering*](https://addyosmani.com/blog/loop-engineering/)、その周回が走る形のほうは [*graph engineering*](https://www.drjoshcsimmons.com/writing/we-are-entering-the-graph-engineering-phase) です。
headsign は、どちらのフレームワークにも属さず、エージェントもグラフも実行しません。
仕事が次にどこへ行ってよいかを書いたファイルを一つ保持して、エージェントが尋ねたときに答えるだけです。
二つ目の名前が指すグラフと、こちらのグラフは別の対象です。
あちらでは辺が型付きの状態をノードからノードへ運び、形は枝分かれし、合流します。
こちらでは辺は何も運ばず、exit code が通る辺を一つ選ぶだけで、枝分かれもしません。

## 機械が握るもの

フェーズを収めるファイルは小さく、そのスキーマはまだ 1.0 より前です。
そのため、構文は直せる [docs/workflow-reference.ja.md](docs/workflow-reference.ja.md) に置いてあります。
ここに書けば、その写しが npm のキャッシュや fork の中で凍りつくからです。
何かを書き始める前に、動かない壁の位置を知る必要があります。

- **走っているフェーズは常に一つです。**
  二つのフェーズが同時に進むことはありません。
- **遷移を決めるのはシェルの exit code** であって、エージェントによる自分の仕事の説明ではありません。
  チェックは普通のコマンド(`bundle exec rspec`、`go test ./...`、`npm test`)で、あなた自身が叩くのと同じように実行されます。
- **分岐は書けます。run が通る辺は一つです。**
  分岐するフェーズは、ファイルに書かれた行き先の中からちょうど一つを選び、そこに無いものを名指しすることはできません。
  合流(join)はありません。
  枝分かれするものも、待つものもありません。
- **フェーズの失敗回数には上限を付けられます。**
  上限を使い切ると run は止まり、その理由を添えて判断を人間に渡します。

headsign は実行状態をワークフローの隣のファイルに置くため、ループはコンテキストの compaction を生き延びます。
再開時は `headsign status` で現在のフェーズを読み、必要な作業を終えてから `headsign next` でゲートを判定します。
`RUNNING` は未完了の run を表し、エージェントのプロセスが稼働しているという意味ではありません。
必要な委譲作業は、権限を持つ運転役が開始します。
そのファイルは、run を開始したディレクトリに属します。
この配置は、複数人が同時に作業する場合にも対応します。
別々のクローンや worktree が run を共有することはありません。
同じディレクトリに二つのセッションが開いているときに、誰が駆動して誰が見ているだけなのかは、[複数セッション](docs/workflow-reference.ja.md#複数セッション)にあります。

本当に並列で仕事を進めたいときは、一段上で組み立ててください。
1 worktree に 1 run とし、その上に、仕事を撒いて回収する何かを置きます。
上の層には、シェルスクリプト、CI のジョブ、既に使っているオーケストレーターを置けます。
子の run が残したものをゲートで読む、親の headsign run でもかまいません。
その層はあなたのものであり続けます。
headsign が握る範囲は run 一つに留まります。
それが何を代償にするかは [headsign がやらないこと](#headsign-がやらないこと)にあります。

これはどれも、あなたの CI を追い出すものではありません。
ゲートが実行するコマンドは、たいてい CI が既に実行しているものです。
headsign の受け持ちは、それをローカルのエージェントループの内側で、フェーズごとに走らせることです。
そうすればプルリクエストは、既にそれらを通り抜けた状態で届きます。

## 出来上がったものを読む

自分の絵ができたら、[example.headsign/](example.headsign/) にある複数のワークフローを参照できます。
テストファーストの機能開発、直す前にまず再現しなければならないバグ修正、ドキュメント、人間の go/no-go を挟むリリース、依頼の種類で振り分けるルーター、キューを 1 周 1 件ずつ片付ける掃引です。
そのうちの一つを言葉にすると、テストファーストのワークフローは spec → red → green → refactor → review と進みます。
spec のゲートは、受け入れ基準の節を備えた仕様書を求めます。
red は、新しいテストがまだ*落ちている*あいだだけ通ります。
green と refactor は、どちらもテストスイートをゲートにします(refactor はそこに lint を足します)。
review は、判定ファイルをゲートにします。
却下されると green へ差し戻され、それが最大三度、そのあとは run が人間に渡ります。

自分が描いた絵に一番近いものを読んでください。
これらは、自分の設計を実際に動くものと突き合わせるために置いてあるのであって、そこから始めるためのものではありません。
仕事の形を自分で決める前にワークフローを採用すれば、その形はハーネスが決めることになります。

このリポジトリ自身のワークフローは `.headsign/` にあります。
このプロジェクトのパスと道具を読むため、サンプルとは分けてあります。

## headsign がやらないこと

採用の前にここを読んでください。
この境界こそが設計です。

- **品質そのものは検証しません。**
  ゲートが証明するのは、そのチェックが証明することだけです。
  テストのゲートは硬く、結果を作文することはできません。
  レビューのゲートは柔らかく、判定ファイルを書くのは LLM です。
  headsign は、*遷移*が決定論的であることを保証します。
  判定の賢さは保証しません。
  硬さの段階と、それが効いてくる場面でペンを作業エージェントの手から外す方法は [ADR-0007](docs/adr/0007-verdict-authorship.md) にあります。
- **オーケストレーションはしません。**
  1 run につきアクティブなフェーズは一つです。
  DAG、並列フェーズ、worktree 管理、プロバイダ抽象化、ペルソナ、テンプレートや式言語、MCP サーバー、TUI、run 横断のダッシュボードは持ちません。
  worktree を*管理*しないことと、worktree の中で作業しないことは別です。
  worktree で開始した run は、最後まで完全にその worktree だけのものです。
  ただし、その worktree を用意すること、子の run を開始すること、後片付けをすることは、あなたの仕事のままです。
  ハーネス側に賢さが必要になったなら、賢さの置き場所が間違っています。
- **あなたのエージェントを走らせません。**
  モデルを従属プロセスとして呼び出す外側ループのランナーとは違い、headsign はあなたのエージェントが問い合わせる相手です。
  プロセスを起動しませんし、セッションも保持しません。
- **使うことを誰にも強制しません。**
  エージェントや同僚に `headsign start` を打たせる仕組みはなく、使わずに済ませても痕跡は残りません。
  機械が握るものを握りはじめるのは、run が始まった瞬間からです。
  ループを習慣にするのはチームの規約の仕事であって、headsign が代行できるものではありません。
- **ネイティブ Windows では動きません。**
  チェックは `/bin/sh`(POSIX)で実行します。
  WSL なら問題なく動きます。

もう一つ、headsign は信頼できる入力ではありません。
headsign は、ワークフローのチェックコマンドをあなたのマシン上のシェルで実行します。
これは `Makefile` のターゲットや npm の `postinstall` と同じです。
自分で書いていない `.headsign/` ディレクトリ、つまりクローンしてきたものや、同僚のプルリクエストに乗って届いたものは、リポジトリの中のほかの実行可能コードと同じように読んでください。

代わりに保持するものは、機械的に保持します。
headsign は、エージェントが言いくるめられない遷移と試行回数の会計を保持します。
さらに、compaction を生き延びる実行状態、run の開始後に働くバックストップ、見たいだけの人のための読み取り専用の `headsign status` を保持します。
バックストップは、run の途中でターンを終えようとしたエージェントをループへ押し戻し、それでも立ち去ったエージェントについては、沈黙ではなくログの 1 行を残します。

### 近縁ツールとの位置関係

**スキル集**は、エージェントが再利用できる指示を提供します。
headsign はゲートの機構を提供し、ワークフローはあなたが用意します。
自分のリポジトリのために描いたものでも、[example.headsign/](example.headsign/) の棚から読んだものでもかまいません。

## 開発

```
npm install
npm test          # node:test。テストフレームワークの依存なし
npm run typecheck
npm run build     # esbuild → plugin/dist/headsign.mjs(コミットする成果物)
```

実行には Node 20 以上、開発には Node 22.6 以上が必要です(テストが TypeScript をそのまま実行するため)。
設計と、その背後にある判断の記録、リリース手順は [docs/](docs/README.md) にあります。
Codex でローカル版を使う手順は、[ローカルプラグイン開発](docs/maintenance.md#local-plugin-development) にあります。

## ライセンス

MIT
