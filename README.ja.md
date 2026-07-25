# headsign

[English](README.md) · [npm](https://www.npmjs.com/package/headsign)

[![npm version](https://img.shields.io/npm/v/headsign)](https://www.npmjs.com/package/headsign)
[![CI](https://github.com/meganemura/headsign/actions/workflows/ci.yml/badge.svg)](https://github.com/meganemura/headsign/actions/workflows/ci.yml)

> 方向幕(ヘッドサイン)は、列車の前面に掲げられる行先表示である。
> これはエージェントループのための方向幕だ。周回のたびにエージェントが行き先を尋ね、headsign がゲートを実行して答える。進むか、やり直すか、終点か。

コーディングエージェントは、驚くほど流暢に仕事を進めます。
テストを書き、実装し、レビューし、次のフェーズへ移ります。
その一連を、こちらが手を出さなくても回してくれます。
このまま任せておけば、うまくいくように見えます。

ところが、ループが前へ進むかどうかを分ける判断が、一つだけあります。
「このフェーズの作業は、本当に終わったのか」。
流暢さは、正しさを保証しません。
「終わりました」という報告が、まだ通っていないテストの上に立っていることがあります。
一番任せたくないのは、まさにこの一点です。

**headsign は、その一点だけを LLM の手から外す、小さなフェーズゲートです。**
作業と会話の主導権は Claude Code が握ったまま、headsign はワークフローの状態を保持して、フェーズの遷移だけを受け持ちます。
あるフェーズを通過とみなすかは、あなたが書いたチェックの exit code だけで決まります。
合否を受けて次にどこへ向かうかは、ワークフローに書いたルーティングが決めます。
どちらの決定にも LLM は加われません。
ただし正直な但し書きが一つあります。
soft gate では、チェックが読む判定ファイルそのものは LLM が書きます。
この境界は隠さず、「headsign がやらないこと」の節と [ADR-0007](docs/adr/0007-verdict-authorship.md) に明記してあります。

エージェントに教える規律は、一文で足ります。
**迷ったら `headsign next` を実行し、答えの 1 行目に従う。**

```
$ headsign next
RETRY 2/5 implement
--- gate failed: unit tests (bundle exec rspec, exit 1) ---
Failures:
  1) Billing::Invoice#total ...
Fix the failure above, then run `headsign next` again.
```

## 設計の考え方

- **Thin Harness, Fat Skills**:賢さは、あなたが書くゲートコマンドと、ループの規律を教えるスキルに置きます。CLI 側は状態遷移機械に徹します。長時間走るプロセスはなく、毎回起動して state を読み、判定し、終了します。
- **決定論的な遷移**:「フェーズが完了した」を LLM 自身の出力で申告させる方式は、一番効いてほしい場面で精度を保証できません。exit code が相手なら、通っていないものを通ったと言い張れません。
- **質問は一つ、駆動者も一つ**:gate も、ダッシュボードもありません。`next` が判定を返し、失敗したときは落ちたチェックとその出力を、そのまま残作業リストとして返します。この質問はリポジトリの誰もが選べるメニューではなく、*駆動している*セッションだけの質問です。もう一つのコマンド `status` は観察者のためのものです。読み取り専用で、判定も遷移も一切行いません([複数セッション](#複数セッション)を参照)。`claim` も判定しません。run の主導権をわざと持ち替える、その一瞬のためだけに、停止境界の hook を介して driver の所有権を委譲されたエージェントへ渡します([複数セッション](#複数セッション)を参照)。
- **主導権は Claude に**:外側のランナーが LLM を従属プロセスとして呼び出すのとは逆で、headsign は Claude が問い合わせる相手であって、Claude を所有するプロセスではありません。

## インストール(Claude Code プラグイン)

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

プラグインには三つが同梱されます。
バンドル済み CLI(npm install もビルドも不要)、規律を教える `workflow` スキル、そしてワークフロー途中の勝手な終了を押し返す停止境界の hook です。

### プラグインなしで使う

プラグインは、headsign を Claude Code 向けに包んだ配布形態の一つにすぎません。
道具の本体は CLI で、ゲート判定、state、`PENDING`、ロック、ログはすべてそこにあり、どのエージェントからでも、手作業でターミナルからでも使えます。
プラグインが上乗せするのは `workflow` スキルと停止境界 hook のバックストップの二つだけで、どちらにもプラグインなしの代替があります。

**CLI をインストールする。** バンドルはコミット済みなのでビルドは不要です:

```
npm install -D headsign
npx headsign --help
```

**エージェントに規律を教える。** スキルの実体はただの指示文であって、仕掛けではありません。
Cursor でも自作ハーネスでも `CLAUDE.md` でも、次のルール一つでほぼ足ります:

> `npx headsign next` を実行し、答えの 1 行目に従うこと。`COMPLETE` 以外で run を終えないこと。意図的に止めるときは `npx headsign abort <reason>` を実行すること。

規律の全文は [plugin/skills/workflow/SKILL.md](plugin/skills/workflow/SKILL.md) にあります。
必要な部分をエージェントのルールに写してもよいですし、GitHub CLI で単体スキルとしてインストールすることもできます(`gh` の preview 機能で、どのエージェントに入れるかを選べます):

```
gh skill install meganemura/headsign workflow
```

Claude Code なら `.claude/skills/` にプロジェクトスキルとして置く手もあります。
これらの方法で得たスキルはプラグインの外で動くため同梱 CLI を見つけられませんが、上記のとおりパッケージをインストールしておけば `npx headsign` にフォールバックします。

**任意: プラグインなしの backstop。** 次の設定を `.claude/settings.json` に書き足します:

```json
{ "hooks": {
  "Stop": [ { "hooks": [
    { "type": "command", "command": "npx", "args": ["headsign", "stop-hook"] }
  ] } ],
  "SubagentStop": [ { "hooks": [
    { "type": "command", "command": "npx", "args": ["headsign", "subagent-stop-hook"] }
  ] } ]
} }
```

`Stop` はセッション自身を、`SubagentStop` はそのセッションが run の駆動を委譲したエージェントを受け持ちます([複数セッション](#複数セッション)を参照)。
run を委譲することがないなら、前者だけを登録すれば十分です。
委譲されたエージェントが駆動していない限り、後者は何もしません。

## クイックスタート

急ぐ場合は、出来合いのワークフローを取得して `run:` を差し替えるところから始められます:

```
mkdir -p .headsign && curl -fsSL -o .headsign/workflow.yaml \
  https://raw.githubusercontent.com/meganemura/headsign/main/example.headsign/tdd-feature.yaml
```

一から書く場合も、必要なのは YAML ファイル一つです:

1. ワークフロー定義をリポジトリにコミットします:

```yaml
# .headsign/workflow.yaml
version: 1
name: feature-dev
entry: plan

phases:
  plan:
    description: 仕様を docs/spec.md にまとめる。受け入れ基準を含めること。
    gate:
      checks:
        - name: spec exists
          run: "test -s docs/spec.md"
        - name: acceptance criteria present
          run: "grep -q '## Acceptance' docs/spec.md"
    on_pass: implement
    max_attempts: 3

  implement:
    description: spec に従ってテストファーストで実装する。
    gate:
      checks:
        - name: unit tests
          run: "bundle exec rspec"
          timeout: 300
    on_pass: review
    max_attempts: 5

  review:
    description: >
      読み取り専用の reviewer サブエージェントに APPROVED か REJECTED かを
      報告させ、その判定を自分の手で .headsign/tmp/verdict に書く。
    clear: [.headsign/tmp/verdict]
    ready: "test -f .headsign/tmp/verdict"
    gate:
      checks:
        - name: review approved
          run: "grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: $end
    on_fail: implement     # 差し戻しループ
    max_attempts: 3        # 3 回却下されたら人間にエスカレート

limits:
  max_total_iterations: 20
```

上の `run:` はいずれも例です。
`bundle exec rspec` は、プロジェクトが実際に使うコマンド(`npm test`、`pytest`、`go test ./...` など)に置き換えてください。
チェックは exit code で判定される単なるシェルコマンドにすぎません。

> **信頼について:** ワークフローの `run:` は、`headsign next` があなたのマシン上で実行するシェルコマンドです。
> `Makefile` のターゲットや npm の `postinstall` と同じ扱いになります。
> 自分で書いていないリポジトリの `.headsign/workflow.yaml` は、その中の実行可能コードと同様に扱ってください。
> `headsign start` や `headsign next` を叩く前に中身を読み、信頼できないリポジトリでは headsign を実行しないでください。
> これは `.headsign/state.json` や `.headsign/lock` についても同様です。
> クローンしたリポジトリにはコミットされた state ファイルや lock が含まれている場合があるため、自分で作成していない `.headsign/` は、ワークフローと同じく信頼できない入力として扱ってください。
> これはチームのリポジトリでも同じです。`.headsign/` への変更は同僚の PR に乗って届き、あなたのループで自動実行されるため、CI の設定への変更と同じ重みでレビューしてください。

2. Claude にワークフローの開始を指示します。
   Claude は `headsign start` を実行してフェーズの作業を進め、答えが `COMPLETE` になるまで `headsign next` を尋ね続けます。
   `ESCALATE` が返ったときは、判断が人間に戻ってきます。

実行状態は `.headsign/state.json` に置かれます(自動で gitignore されます)。
状態がすべて外部にあるため、`/compact` でコンテキストが飛んでも、復帰は `headsign next` 一発です。

`headsign start`、`next`、`abort` が見るのはカレントディレクトリの `.headsign/` だけで、親ディレクトリは探索しません。
そのため、これらのコマンドはワークフローのある場所、通常はリポジトリまたは git worktree のルートで実行してください。
各 worktree はそれぞれ独立した run を持ちます。
例外は停止境界の hook で、こちらは深いサブディレクトリでターンが終わっても、run のある `.headsign/` を worktree のルートまで遡って見つけます。
ただしこの遡りは上方向にしか進みません。
モノレポのルートのように run のあるディレクトリより上でセッションが止まっていると、hook は run を見つけられず沈黙するので、ワークフローのあるディレクトリかその配下で作業してください。

**1 worktree に 1 run**、これが headsign の worktree サポートのすべてであり、構造上そうなっています。
linked worktree の `state.json`、lock、log はいずれもその worktree 自身の `.headsign/` に置かれ、headsign は共有の `.git` ディレクトリの下には何も書きません。
そのため、同じリポジトリの二つの worktree は、それぞれ自分のフェーズで、互いに干渉することなくループを回せます。
それより先は対象外です。
worktree どうしが run の状態を共有することはなく、headsign がその中の run を協調させることも、一つのビューにまとめることもありません。
run は、それを開始したディレクトリのものです。

## 段取りとゲート

各フェーズの `description` は、そのフェーズで Claude にやってほしいことをそのまま書く欄です。
「`/foo` スキルを使う」「読み取り専用の reviewer サブエージェントにレビューさせる」といった指示も、ここに書けばそのまま Claude に渡ります。
ただしこれは段取りであって、強制ではありません。
ワークフローは、スキルやサブエージェントの仕事をゲート付きの順番に並べる緩い段取りであって、どのスキルを使うかまでは縛りません。
実際に効くのはゲートのほうで、チェックの exit code だけが結果を確かめます。
あるスキルの使用を必須にしたいなら、その成果物を確かめるゲートを書きます(たとえば、そのスキルが生むファイルを `grep` します)。
レビューのような soft gate のフェーズでは、判定ファイル(`.headsign/tmp/verdict` など)を、そのフェーズの `clear:` に挙げておくとよいでしょう。
前回の判定が残っていると、今回の判定と取り違えられてしまいます。
headsign がフェーズ進入のたびにそれを削除するので、読み取り専用の reviewer が判定を報告したあと、Claude がそのつど新しく書き直すことになります。
判定そのものを作業エージェントの手から出したい場合は、チェック自体を審査者にできます。
たとえば `claude -p '… APPROVED か REJECTED だけを返せ' | grep -qx APPROVED` なら、遷移は決定論のままペンの持ち主だけが替わります。
トレードオフは [ADR-0007](docs/adr/0007-verdict-authorship.md) にまとめてあります。

フェーズの意味は、そのゲートがシェルで確かめられる範囲までしかありません。
テストのゲートが証明するのは「何も壊れていない」ことであって、「機能が完成した」ことではありません。
「完成したか」を判断するのはレビューのゲートの役目であり、上のクイックスタートのワークフローが両方を備えているのはそのためです。
シェルでは判断できない仕事、設計判断や UX の判断は、チェックで確かめられる単位に切り分けるか、レビューのような soft gate に委ねる必要があります。
フェーズの粒度は、仕事の自然な区切りではなく、ゲートが実際に確かめられる範囲に合わせてください。
レビューのフェーズはエージェント自身のレビュー規律であって、人間が PR をレビューすることの代わりではありません。

## 実行の流れ

ループを回すのは三者です。
**Claude** が作業を進めてループを駆動し、**headsign** が現在のフェーズのゲートを実行してトークンで答え、**チェック**は普通のシェルなので判定は決定論的になります。
周回のたびに Claude はトークンに従います。
`RETRY` なら報告された失敗を直して再度尋ね、`ADVANCE` なら表示されたフェーズへ移り、失敗時ルーティング(`gate failed → routed to …`)なら作業が差し戻され、`COMPLETE` で run が終わります。
上のクイックスタートのワークフローを一度回すと、こう進みます。

```mermaid
sequenceDiagram
    autonumber
    actor C as Claude
    participant H as headsign
    participant S as ゲートのチェック

    C->>H: headsign start
    H-->>C: START plan(フェーズの指示)
    Note over C: docs/spec.md を書く
    C->>H: headsign next
    H->>S: plan のチェックを実行
    S-->>H: exit 1(spec 不足)
    H-->>C: RETRY 1/3 plan(落ちたチェックと出力)
    Note over C: spec を直す
    C->>H: headsign next
    H->>S: plan のチェックを実行
    S-->>H: exit 0
    H-->>C: ADVANCE implement
    Note over C: テストファーストで実装
    C->>H: headsign next
    H->>S: bundle exec rspec
    S-->>H: exit 0
    H-->>C: ADVANCE review(.headsign/tmp/verdict を clear)
    Note over C: 読み取り専用の reviewer が REJECTED と報告し、<br/>Claude が .headsign/tmp/verdict に書く
    C->>H: headsign next
    H->>S: grep -qx APPROVED .headsign/tmp/verdict
    S-->>H: exit 1(REJECTED)
    H-->>C: ADVANCE implement(gate failed → 差し戻し)
    Note over C: 手直し。implement が再度パスし、<br/>ADVANCE review で verdict を再び clear、<br/>今度は reviewer が APPROVED と報告し、Claude が書く
    C->>H: headsign next
    H->>S: grep -qx APPROVED .headsign/tmp/verdict
    S-->>H: exit 0
    H-->>C: COMPLETE
```

headsign から出る矢印はすべてシェルの exit code で駆動され、LLM の自己申告では動きません。
図には出していませんが、停止境界の hook がバックストップです。
run が `running` の間に、その run の駆動者が止まろうとすると、`headsign next` に差し戻されます。

## コマンドと出力の契約

コマンドは六つで、駆動しているセッションが日常的に使うのは一つだけです。

| コマンド | 役割 |
|---|---|
| `headsign start [name] [--workflow path]` | state を初期化し、entry フェーズの指示を表示する |
| `headsign next` | **駆動しているセッションが尋ねる唯一の質問。** 現在のゲートを実行し、遷移して答える |
| `headsign abort [reason]` | 人間の指示による中断を記録する |
| `headsign validate [name] [--workflow path]` | ワークフロー定義の静的検証 |
| `headsign status` | 駆動していないセッションのための、現在の run の読み取り専用ビュー([複数セッション](#複数セッション)を参照) |
| `headsign claim` | `SubagentStop` hook を介して driver の所有権を委譲されたエージェントに渡す。run の駆動を誰に任せるかを委譲するためのコマンド([複数セッション](#複数セッション)を参照) |

複数のワークフローは `.headsign/` 配下に別々のファイルとして置けます(1 ファイル 1 ワークフロー)。
`headsign start <name>` で選ぶと `.headsign/<name>.yaml` を使います。
明示的なパスを指定したい場合は `--workflow <path>` を使います。
ロール別の実例(TDD 開発、バグ修正、ドキュメント執筆、リリース)は [example.headsign/](example.headsign/) にあります。
このリポジトリ自身の `.headsign` はそこへのシンボリックリンクです。

無引数の `headsign validate`(name も `--workflow` も指定しない場合)は、現在の run が実際に使っているワークフローを検証します。
`.headsign/state.json` が存在すれば(status を問わず)、固定のデフォルトファイルではなく、その run 自身の `workflow_path` を検証対象にします。
そのため `headsign start <name>` で開始した run を検証するときは、名前を繰り返さなくても正しい `.headsign/<name>.yaml` が検証されます。
run が存在しない場合は、従来どおり `.headsign/workflow.yaml` にフォールバックします。
明示的な `<name>` や `--workflow <path>` は、どちらの場合よりも常に優先されます。

`next` の答えは、1 行目が機械可読トークン、以降がエージェント向けの指示です。

| 1 行目 | exit | 意味 |
|---|---|---|
| `ADVANCE <phase>` | 0 | ゲート通過(または失敗時ルーティング)。新フェーズの指示が続く |
| `RETRY n[/max] <phase>` | 1 | ゲート失敗。落ちたチェックと出力の末尾が続く |
| `PENDING <phase>` | 1 | ゲートがまだ判定できない(`ready:`)。試行回数には数えない。作業を終えてから再度 `next` |
| `COMPLETE` | 0 | 終点 |
| `ESCALATE <reason>` | 2 | 人間の判断が必要 |
| `ABORT <reason>` | 2 | 中断済み |

exit 3 は設定または使用方法のエラーです。
終了済みの run に対する `next` は冪等で、作業ツリーが無変更のときは前回の判定を再表示するだけなので、様子見の `next` で試行回数が減ることはありません。

### ルーティング(workflow.yaml)

| フィールド | 値 | デフォルト |
|---|---|---|
| `on_pass` | フェーズ名、`$end` | なし(必須) |
| `on_fail` | `retry`、フェーズ名、`$end`、`escalate`、`abort` | `retry` |
| `max_attempts` | 正の整数。そのフェーズが最後に通過してからの失敗回数を数える | 無制限 |
| `on_exhausted` | `escalate`、`abort` | `escalate` |
| `limits.max_total_iterations` | 正の整数。全体の暴走防止 | なし |

チェックは CI で見慣れた `- name:` / `run:` / `timeout:` のステップで、`/bin/sh -c` で実行されます(最初の失敗でゲートは打ち切られます)。
フェーズには `env:` を設定できます。
`needs:` や `if:`、`${{ }}`、matrix、トリガーは意図的に持ちません。
ルーティングを決めるのはゲートの pass / fail だけです。

### 非同期レビュー(レビューに時間がかかる場合)

レビューフェーズのゲートは、ループ自身より遅い何かに依存することが多いものです。
たとえば、まだ diff を読んでいる reviewer サブエージェントや、PR を眺めている人間です。
判定がまだ無いうちに `next` を呼ぶと、`ready:` が無ければ、まだ何も判定していないゲートに対して試行回数を 1 つ消費してしまいます。
さらにそのフェーズの判定ファイルは `clear:`(上で推奨した設定)にも挙げてあるので、少し遅れて届いた判定を、その早すぎた呼び出し自身の再入場が握りつぶしてしまうことすらあります。
本物のレビューが、静かに失われるということです。
フェーズに `ready:` プローブ(たとえば `test -f .headsign/tmp/verdict`)を持たせれば、早すぎた `next` は `PENDING` を返すようになります。
試行回数は消費されず、`clear:` も走らず、判定ファイルは、実際にそれを見つける `next` のためにそのまま残ります。
`.headsign/` 配下(tmp/ を含む)は gitignore に関係なく tree-hash の監視対象なので、判定ファイルの書き込みは必ず検知されます。

### バックストップ

スキルは指示であって、強制ではありません。
そこで 2 つの停止境界 hook が `.headsign/state.json` を読み、run が `running` の間は、その run の**駆動者**のターン終了だけをブロックして `headsign next` に差し戻します。
駆動者のものでないと*証明できる*ターン、つまり識別子が解決できて、刻印された値と食い違うターンは、そのまま通ります。
completed、escalated、aborted も正しい終わり方なので、同じく通します。

判断がつかない場合、2 つの hook は意図的に逆の方向へ倒します。
どちらの側からも識別子が得られないとき、`Stop` は従来どおり催促します。
run のあるディレクトリで止まったセッションは、その run の駆動者である可能性が高く、本物を取り逃がすほうが余計な催促 1 回よりも痛いからです。
`SubagentStop` は逆に通します。
近くで止まる委譲エージェントの多くは、その run に何の役目も持たないレビュアーや作業者であり、そうした相手を引き止めてしまうほうが、催促を 1 回逃すよりも痛いからです。

hook が 2 つあるのは、駆動者になりうるターンループが 2 種類あるからです。
セッションのターン終了では `Stop` が、委譲されたエージェントのターン終了では `SubagentStop` が発火します。
委譲されたエージェントは `Stop` を一切発火させないため、2 つ目の hook が無いとバックストップを持てません。
そればかりか、run はそのエージェントを spawn しただけのセッションを催促し続けてしまいます([複数セッション](#複数セッション)を参照)。

意図的に中断するには、`.headsign/tmp/stop-note` に理由を 1 行書いてから、もう一度停止してください。
hook は即座に通り、差し戻しは不要で、`.headsign/log` に `paused` 行が残るので中断の記録が残ります。
note は読まれた瞬間に消費され(削除され)、作業ツリーは中断前とまったく同じ状態(正味無変化)に戻るため、キャッシュは保たれます。
翌日 `headsign next` を実行すれば同じフェーズから再開し、他に変更がなければキャッシュされた判定を再表示するだけなので、試行回数は消費されません。
`headsign abort <reason>` はもう一方の出口で、一時停止ではなく恒久的な終了です。
run は再開できず、新しく `headsign start` すると entry フェーズからやり直しになり、すべてのフェーズのゲートを最初から再実行することになります。
その再実行を安く保つのは headsign の仕事ではなく、ワークフロー側に課された設計要求です。
早いフェーズのゲートは、ファイルの存在確認や lint のような、速くて冪等なチェックとして書いてください。
本物の副作用を持つチェックや、やり直しの効かない長い処理にはしないでください。
そうすれば abort 後の再スタートはほとんど負担になりません。
早いフェーズのゲートが遅い、あるいは冪等でないワークフローは、自分自身の再実行コストを自分で高くしているのであり、それはワークフロー作者が背負うべきコストであって、headsign が肩代わりできるものではありません。

note を書かずに停止した場合は差し戻されます。
hook は fail-open で(セッションを閉じ込めることはありません)、実評価も note もない差し戻しが連続 5 回に達するとそこでやめます。
5 回目の差し戻しで `.headsign/log` に `stalled` 行が残り、それ以降の停止は静かに通ります。
この上限は行き詰まったエージェントや黙って離脱したエージェントのための保険であって、通常の中断手段は note のほうです。
外側から放置状態を見つけるには、`headsign status`(読み取り専用で、どのセッションから実行しても安全です。[複数セッション](#複数セッション)を参照)が `RUNNING` を報告し、かつ `.headsign/log` の末尾に `stalled` が見えるかを確認してください(`stop_nudges` が 5 以上でも同じです)。
両方がそろえば、駆動していたエージェントが note を残さず離脱したということです。
実際に run を駆動しているセッションから `headsign next` を実行して、再投入してください。

## 複数セッション

一つのリポジトリに、同時に複数の Claude Code セッションが開いていることはよくあります。
リードセッションと teammate たち、あるいは自分を spawn したセッションと並行して動くサブエージェントなどです。
ある run について `headsign next` に答えてよいのはそのうちの一つだけで、headsign はそのセッションを**駆動者(driver)**と呼びます。
それ以外はすべて**観察者(observer)**です。
この区別が存在するのは、Stop hook(前述)がかつて、run が `running` の間に停止した*すべて*のセッションを、駆動者か観察者かを問わず差し戻していたためです。
差し戻しに従ってしまった観察者は、自分には関係のない retry を消費したりフェーズを進めたりしかねません。
しかもどのセッションからのブロックされた停止も、同じ共有の nudge 上限カウンタを消費するため、傍観者のターン終了が数回重なるだけでそれを使い切り、本物の駆動者に対する backstop を黙って無効化してしまうことがありました。
設計の全体像とこれを引き起こした実戦フィードバックについては [ADR-0008](docs/adr/0008-multi-session-ownership.md) を参照してください。

`start` と `next` は、そのときに環境から解決できたセッション識別子を `.headsign/state.json` の `driver_session` に刻みます(解決できなかった場合に「何もない」で上書きすることはありません)。
そのため所有権は、常に直近でその run を駆動したセッションを指し続けます。
Stop hook は、いま停止したのが誰かという自分の判断をこの刻印と照合し、非駆動者だと確認できたセッションの停止はそのまま通します(state は変更されず、nudge も出しません)。
どちらか一方でも解決できない場合は従来どおりの挙動にフォールバックするため、この変更が無実のセッションをブロックする新しい経路を生むことはなく、通す経路が増えるだけです。
識別子がまったく解決できない環境向けの手動での上書き手段が `HEADSIGN_OBSERVER`(後述)です。

駆動者が*セッション*である限り、この自動刻印だけで話は完結します。
一つのセッションが単独で作業している場合も、別々のターミナルで複数のセッションが動いている場合も同じです。
そこでは claim は要りません。
自動刻印が唯一カバーできないのは、セッションが駆動を**委譲した**エージェントが run を回す場合で、`headsign claim` はそのためにあります(後述)。

所有権は単に直近でその run を駆動したセッションに従うだけなので、離れていた駆動者が戻ってきたときも `headsign next` 一発で所有権を取り戻せます。
別途の再取得手順は要りません。
それ以外のセッション、つまり teammate、その run を任されていないサブエージェント、あるいは一度も `headsign start` を実行していないセッションは、代わりに `headsign status` を使ってください。

### `headsign status`

読み取り専用です。
gate は実行されず、state も書き込まれず、lock も取得されません。
どのセッションからでも、いつでも、何度でも安全に実行できます。

```
$ headsign status
RUNNING implement (attempt 2/5)
workflow: feature-dev
--- last failure: unit tests (bundle exec rspec, exit 1) ---
Failures:
  1) Billing::Invoice#total ...
driver: this session
```

```
$ headsign status
COMPLETE
workflow: feature-dev
```

```
$ headsign status
ESCALATED
workflow: feature-dev
reason: review rejected 3 times
```

1 行目は `RUNNING` / `COMPLETE` / `ESCALATED` / `ABORTED` のいずれかです。
`next` のトークンと同じく大文字表記ですが、これは*報告*であって判定ではありません。
`status` が `ADVANCE` や `RETRY`、`PENDING` を表示することは決してありません。
判定を一切行わないためです。
`driver:` 行(`RUNNING` のときだけ表示されます)は、自セッションの解決済み識別子が刻印された driver と一致すれば `this session`、両方が解決できて食い違えば `another session`、どちらか一方でも解決できなければ `unknown` になります。
`headsign claim` による引き継ぎ(後述)のあとは、代わりに `driver: a delegated agent` と表示されます。
`status` は、claim された run について this session か another session かを意図的に推測しません。
そこに記録されているのはそもそもセッション識別子ではなく、しかも `claim` を必要にしているのと同じ解決不能な溝が、そのエージェントが呼び出し元本人かどうかを CLI に判断させないからです。
この行は、手元にある事実だけを述べて、それ以上は言いません。

exit code は `next` とは意図的に異なる契約に従います。
`status` は `.headsign/state.json` が読めさえすれば常に exit 0 を返します。
`ESCALATED` や `ABORTED` の run も、状態エラーではなく通常の報告用出力です。
exit 3 になるのは、報告できるものが何もないとき(run がここに無い、または state が読めないとき)だけです。
そのため `status` を `set -e` でラップしたスクリプトは、観察している run がたまたま人間の判断を必要としているというだけでは落ちません。
run 自体の状態は exit code ではなく 1 行目から読み取ってください。

### 駆動者を委譲する: `headsign claim`

**委譲されたエージェント**、つまり Claude Code の agent-teams 機能における teammate や、サブエージェントは、上で述べた自動刻印が唯一扱えない駆動者です。
この種のエージェントは、自分を spawn したセッションのプロセスをそっくり共有していて(PID も環境も同一)、Bash tool の手が届く範囲のどこにも自分固有の識別子を持ちません。
そのため、そこから `headsign next` を呼んでも、刻まれるのは*spawn 元のセッション*の識別子です。
ただ「この run を駆動してほしい」と頼むだけでは、誤った駆動者が黙って記録されることになります。

`headsign claim` は、刻印の役目を hook に譲ることでこれを解決します。
エージェント自身の環境からは分からないことを、Claude Code は hook には教えてくれるからです。
手順は 2 拍です。

1. run を駆動させたいエージェントから `headsign claim` を実行します。
   これは一発券のマーカーを構え、ターンを終えるよう伝えるだけで、それ自体は何も刻印しません。
2. そのターンを終えます。
   **駆動者が確定するのは、そのエージェント自身のターン終了です**(Claude Code が、そのエージェント固有の識別子を載せた `SubagentStop` hook を発火させます)。
   headsign はそれを `.headsign/state.json` の `driver_session` / `driver_source` に書き込み、`.headsign/log` に `claimed` 行を記録し、hook のメッセージでそれを確認します。
   `headsign next` を実行する前に、その確認メッセージを待ってください。
   正しいエージェントが着席したと分かるのは、それによってだけです。

典型的な委譲はこう進みます。
「この run を頼む」→ 委譲されたエージェントが `headsign claim` を実行してターンを終える → 確認メッセージが届く → そのまま `headsign next` で駆動を始める、という流れです。
この方法で claim した所有権は粘着性があります。
同じ共有環境からの無関係な `next` 呼び出しが、素の env 刻印のように黙って奪い返すことはありません。
セッション自身の停止が claim を採用することは一切ないので、仕事を委ねた側のセッションが先に停止して座を奪ってしまうこともありません。

駆動者になるということは、backstop もついてくるということです。
いったん着席すれば、run が `running` の間、そのエージェント自身のターン終了は `headsign next` に差し戻され、stop-note による一時停止も `headsign abort` による終了も、セッションの場合とまったく同じように使えます。
run の駆動者ではないエージェントが引き留められることはありません。
reviewer サブエージェントも、まったく別の作業をしているエージェントも、普通に停止します。

これは lock ではなくハンドシェイクです。
マーカーを構えている間に*別の*委譲されたエージェントがたまたまターンを終えると、そちらが採用されてしまいます。
その場合は正しいエージェントからもう一度 `headsign claim` を実行してください。
新しい claim は常に勝ち、今度は必ず着地します。
そのエージェント自身のターン終了が、確定を行うイベントを確実に発火させるからです。
仕組みの全体像、その裏付けとなった実測、そして残るレースについては [ADR-0010](docs/adr/0010-subagent-stop-identity.md) にあります。

### 環境変数

| 変数 | 設定する主体 | 意味 |
|---|---|---|
| `HEADSIGN_SESSION_ID` | あなた自身が明示的に | headsign が駆動者の所有権判定に使うセッション識別子です。どのハーネスでも動作します。安定したセッションごとの値を export すれば headsign がそれを使います。最初にチェックされます。 |
| `CLAUDE_CODE_SESSION_ID` | Claude Code が自動的に | `HEADSIGN_SESSION_ID` が未設定のときだけ使われます。これは Claude Code のインターフェースとして文書化された公開仕様では**ありません**。headsign がこれに頼っているのは、今のところ公開された代替手段が無いからにすぎません。将来のリリースでこれが削除されたり変更されたりした場合、headsign は単に駆動者識別子を自動解決できなくなります。`driver_session` は刻印されなくなり、Stop hook は running な run へのすべての停止に対して(駆動者か観察者かを問わず)nudge を出す、この機能が存在する前とまったく同じ挙動にフォールバックします。何も壊れません。nudge の対象を絞り込む機能が働かなくなるだけです。 |
| `HEADSIGN_OBSERVER` | あなた自身が明示的に | 空でない任意の値(慣習として `=1`)を設定すると、駆動者の所有権にかかわらず、そのセッションの停止と、そのセッションが委譲したエージェントの停止が、停止境界の hook を無条件に通過するようになります。自分がもっぱら観察しているだけだと分かっているセッション向けの手動 opt-out です。セッション識別子がまったく解決できない環境では特に有用です。 |

**規則:** `headsign start` を実行しておらず、run の駆動も任されていないセッションは、`headsign next` や `headsign abort` ではなく `headsign status` を使ってください。

## headsign がやらないこと

採用の前にここを読んでください。
この境界こそが設計です。

- **品質そのものは検証しません。** ゲートが証明するのは、そのチェックが証明することだけです。テストのゲートは硬く、結果を作文できません。レビューのゲートは柔らかく、判定ファイルを書くのは LLM です。headsign が保証するのは遷移の決定論であって、判定の賢さではありません。硬さの段階と、ペンを作業エージェントの手から外す方法は [ADR-0007](docs/adr/0007-verdict-authorship.md) にあります。
- **使うことを強制しません。** エージェントや同僚に `headsign start` を打たせる仕組みはなく、使わなかった痕跡も残りません。ループを習慣にするのはチームの規約の仕事で、headsign には代行できません。
- **オーケストレーションはしません。** 1 run につきアクティブなフェーズは一つです。DAG、並列フェーズ、worktree 管理、プロバイダ抽象化、ペルソナ、テンプレートや式言語、MCP サーバー、TUI、run 横断のダッシュボードは持ちません。ただし、worktree を*管理*しないことと、worktree の中で作業しないことは別です。worktree で開始した run は最後まで完全にその worktree だけのもので、1 worktree に独立した run 一つという関係が保たれます([クイックスタート](#クイックスタート)を参照)。ハーネス側に賢さが必要になったら、それは賢さの置き場所が間違っています。
- **ネイティブ Windows では動きません。** チェックは `/bin/sh`(POSIX)で実行します。WSL なら動きます。

代わりに保持するものは、機械的に保持します。
エージェントが言いくるめられない遷移と試行回数の会計、compaction を生き延びる実行状態、黙って辞めることを痕跡なしには許さないバックストップ、そして試行を消費しない様子見です。

### 近縁ツールとの位置関係

- **Superpowers などのスキル集**: 磨かれた固定ワークフローを同梱します。headsign はゲートの機構だけを持ち、ワークフローは持参します([example.headsign/](example.headsign/) から始められます)。
- **ralph 系ループ**(完了まで再投入し続ける方式): 競合ではなく補完です。headsign はそのループの内側で、停止条件とフェーズの記憶として機能します。ランナーは `state.json` が終端になるまでエージェントを呼び直すだけです。
- **takt**: エージェントを自ら走らせる本格的なオーケストレーターで、worktree 並列やペルソナまで備えます。headsign は関係を反転させ、エージェントが主導してゲートに問い合わせる形を取ります。この道具の出発点は takt を実際に使った経験にあり、単一エージェントが自走する一片には意図的に小さな道具が合う、と教えてくれたのは takt でした。
- **jdi**: 最も軽い隣人で、フェーズの遷移をエージェント自身が出力へ印すことで進めます。headsign はその軽さを保ったまま、いちばん大事な一点である遷移の判定だけを、LLM の文章から exit code へ移したものです。

### 採用すべきか、あなたのエージェントに診断させる

headsign が効くのは、「終わった」を機械的に確かめられる場所だけです。
自分のリポジトリを測ってみてください。
次のプロンプトをコーディングエージェントに貼るだけです(読み取り専用で、何も変更しません):

```text
このリポジトリが、エージェント作業のフェーズゲート(シェルのチェックが通った
ときだけ工程を先へ進めるツール)の恩恵を受けるかを、読み取り専用で診断せよ。
1. 機械的なシグナルの棚卸し: 作業の状態を証明できるコマンド(テストスイート、
   型チェック、lint、ビルド)は何があるか。主要なものの所要時間も概算せよ。
2. 直近のマージ済み PR(依存更新や chore は除く)から、典型的な作業単位を
   復元せよ。それは 2〜5 個の工程に分割でき、各工程に機械的に確認できる完了
   (テスト green、成果物の存在)と、シェルには判定できない判断(レビュー)
   があるか。
3. このツールが存在する理由となる事故を探せ: 完了と申告されたのに終わって
   いなかった痕跡(初回 push で赤い CI、fixup コミット、revert)。
4. 報告せよ: シグナル一覧と所要時間、作業がゲート可能な工程に分割できるか、
   「終わった」が嘘だった頻度の概算、そして High/Medium/Low の適合判定と
   3 行の根拠。
```

**High**(チェック可能なシグナルがあり、「終わった」に裏切られた実績がある)なら採用し、example のワークフローから始めてください。
**Medium** なら、繰り返しの多い作業種別を一つ選んで導入してください。
**Low**(走らせられるチェックが無い)なら見送ってください。
機械的なシグナルが無ければゲートが握るものは何も無いので、先にそちらを整えるのが順序です。
どの判定でも、エージェントが返すシグナル一覧はそのままゲートの下書きになります。

## 開発

```
npm install
npm test          # node:test。テストフレームワークの依存なし
npm run typecheck
npm run build     # esbuild → plugin/dist/headsign.mjs(コミットする成果物)
```

実行には Node 20 以上、開発には Node 22.6 以上が必要です(テストが TypeScript をそのまま実行するため)。
設計は [docs/architecture.md](docs/architecture.md) に、各判断の背景は [docs/adr/](docs/adr/README.md) にまとめてあります。
リリースとメンテナンスの手順は [docs/maintenance.md](docs/maintenance.md) にあります。

## ライセンス

MIT
