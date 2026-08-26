# headsign

[English](README.md) · [npm](https://www.npmjs.com/package/headsign)

[![npm version](https://img.shields.io/npm/v/headsign)](https://www.npmjs.com/package/headsign)
[![CI](https://github.com/meganemura/headsign/actions/workflows/ci.yml/badge.svg)](https://github.com/meganemura/headsign/actions/workflows/ci.yml)

> 方向幕(ヘッドサイン)は、列車の前面に掲げる行先表示である。
> headsign は、エージェントループの方向幕だ。
> 周回のたびにエージェントが行き先を尋ね、headsign がゲートを実行して答える。
> 進むか、やり直すか、終点か。

**headsign は、コーディングエージェントのための小さなフェーズゲートです。**
あなたのエージェントが作業を進め、会話を主導します。
headsign は run の状態を保持し、作業が次のフェーズへ進んでよいかを判定します。
エージェントに必要な規律は、一文で足ります。
**作業をしたら `headsign next` を実行し、答えの 1 行目に従う。**

headsign が握るのは、その一つの判断だけです。
あなたのフェーズがどうあるべきかについて、headsign は見解を持ちません。
一つのフェーズをエージェントがどうやり遂げるかについても持ちません。
ある工程を三体のサブエージェントに任せるか、二つの作業を同時に走らせるかを決めるのはエージェントであって、この道具が許可を与えるものではありません。
仕事の形はファイルに書かれ、run と run のあいだで書き換えられます。
書き換えるのは人の手でも、エージェントでもかまいません。
その仕事の形が良くなっていきます。
エージェント側では、仕事の形を決める判断が速く良くなっています。
あなたのリポジトリのためにあなたのエージェントが設計するループは、外から推し量ったハーネスの作者が用意するループに勝ちます。
今日の答えを焼き込んだハーネスは、天井になります。
そのため、グラフはあなたが変えるものであり、グラフが問い合わせる道具のほうは動かずにいます。

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

エージェントは、終わっていない仕事を終わったと言います。
悪意からではありません。
ターンを終えようとするモデルには、自分を検算する手立てがありません。
そのため、「実装しました、テストは通るはずです」という文は、テストの成否にかかわらず同じになります。
下流のすべてが、その一文の上に建ちます。
headsign は、その一文を exit code に置き換えます。

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
インストール後に `/hooks` を開き、二つのコマンドを確認して信頼すると、バックストップが動きます。

そのコマンドの中に、間違いに見えて間違いではないものが一つあります。
プラグイン自身の置き場が `CLAUDE_PLUGIN_ROOT` で渡されることです。
この名前は Codex が定義していて、Codex 自身の公式プラグインもこの名前で hook を登録しています。
実測の内容と、素の `PLUGIN_ROOT` を使わない理由は [ADR-0028](docs/adr/0028-codex-as-a-second-principal.md) にあります。

Claude Code では、プラグインとして:

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

どちらのホストでも、同じ四つが同梱されます。
同梱されるのは、バンドル済み CLI(npm install もビルドも不要)、ループの規律を教える `workflow` スキル、YAML を一緒に書く `design-workflow` スキル、run の途中でエージェントが黙って抜けるのを押し返す停止境界の hook です。

Codex の hook 契約には、`cwd`、`session_id`、`Stop`、`SubagentStop` が明記されています。
そのため、バックストップは両方のホストで動きます。
Codex の通常の CLI コマンドで使える公開セッション環境変数は、公式資料で確認できませんでした。
そのため、Codex で `start` または `next` を実行しても、headsign は `last_drive.session` を記録できません。
既存の記録が無い未 claim の Codex run では、一致する各セッションにバックストップが働くことがあります。
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
復帰は `headsign next` をもう一度打つだけです。
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

**スキル集**(Superpowers とその同類)は、磨かれた固定のワークフローを同梱します。
headsign が同梱するのはゲートの機構だけで、ワークフローはあなたが持参します。
自分のリポジトリのために描いたものでも、[example.headsign/](example.headsign/) の棚から読んだものでもかまいません。

## 開発

```
npm install
npm test          # node:test。テストフレームワークの依存なし
npm run typecheck
npm run build     # esbuild → plugin/dist/headsign.mjs(コミットする成果物)
```

実行には Node 20 以上、開発には Node 22.6 以上が必要です(テストが TypeScript をそのまま実行するため)。
設計と、その背後にある判断すべての記録、そしてリリース手順は [docs/](docs/README.md) にあります。

## ライセンス

MIT
