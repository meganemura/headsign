# headsign

[English](README.md)

> 方向幕(ヘッドサイン)は、列車の前面に掲げられる行先表示である。
> これはエージェントループのための方向幕だ。周回のたびにエージェントが行き先を尋ね、headsign がゲートを実行して答える。進むか、やり直すか、終点か。

**headsign はコーディングエージェントのための小さなフェーズゲートである。**
作業と会話の主導権は Claude Code が持ち、headsign はワークフローの状態を保持してフェーズ遷移だけを判定する。
判定は常に決定論的で、シェルコマンドの exit code だけで決まる。
LLM は判定に関与せず、判定結果を読むだけである。

エージェントに教える規律は一文に収まる。
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

- **Thin Harness, Fat Skills**:賢さはゲートコマンド(利用者が書くシェル)と、ループの規律を教えるスキルに置く。CLI は状態遷移機械に徹する。長時間走るプロセスはなく、毎回起動して state を読み、判定して、終了する。
- **遷移は決定論的**:「フェーズが完了した」を LLM 自身の出力で申告させる方式では、一番重要な判定の精度を保証できない。headsign では、チェックが exit 0 を返したときだけフェーズが進む。
- **質問は一つ**:status も gate も、ダッシュボードもない。`next` が判定を返し、失敗時にはそのまま残作業リスト(落ちたチェックとその出力)を兼ねる。
- **主導権は Claude に**:LLM を従属プロセスとして呼び出す外側のランナーとは逆に、headsign は Claude が問い合わせる相手であって、Claude を所有するプロセスではない。

## インストール(Claude Code プラグイン)

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

プラグインには三つが同梱される。
バンドル済み CLI(npm install もビルドも不要)、規律を教える `loop` スキル、そしてワークフロー途中の勝手な終了を防ぐ Stop hook である。

## クイックスタート

1. ワークフロー定義をリポジトリにコミットする:

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
      reviewer サブエージェント(読み取り専用ツールのみ)に、
      .headsign/verdict へ APPROVED または REJECTED を書かせる。
    gate:
      checks:
        - name: review approved
          run: "grep -qx APPROVED .headsign/verdict"
    on_pass: $end
    on_fail: implement     # 差し戻しループ
    max_attempts: 3        # 3 回却下されたら人間にエスカレート

limits:
  max_total_iterations: 20
```

上の `run:` はいずれも例である。`bundle exec rspec` は、プロジェクトが実際に使うコマンド(`npm test`、`pytest`、`go test ./...` など)に置き換えること。チェックは exit code で判定される単なるシェルコマンドにすぎない。

> **信頼について:** ワークフローの `run:` は、`headsign next` があなたのマシン上で実行するシェルコマンドである。`Makefile` のターゲットや npm の `postinstall` と同じ扱いになる。自分で書いていないリポジトリの `.headsign/workflow.yaml` は、その中の実行可能コードと同様に扱うこと。`headsign start` や `headsign next` を叩く前に中身を読み、信頼できないリポジトリでは headsign を実行しない。

2. Claude にワークフローの開始を指示する。
   Claude は `headsign start` を実行してフェーズの作業を進め、答えが `COMPLETE` になるまで `headsign next` を尋ね続ける。
   `ESCALATE` が返ったときは、判断が人間に戻ってくる。

実行状態は `.headsign/state.json` に置かれる(自動で gitignore される)。
状態がすべて外部にあるため、ループはコンテキストの compaction をまたいで生き残る。
復帰は `headsign next` 一発である。

## コマンドと出力の契約

コマンドは四つで、エージェントが日常的に使うのは一つだけである。

| コマンド | 役割 |
|---|---|
| `headsign start [--workflow path]` | state を初期化し、entry フェーズの指示を表示する |
| `headsign next` | **唯一の質問。** 現在のゲートを実行し、遷移して答える |
| `headsign abort [reason]` | 人間の指示による中断を記録する |
| `headsign validate [--workflow path]` | ワークフロー定義の静的検証 |

`next` の答えは、1 行目が機械可読トークン、以降がエージェント向けの指示である。

| 1 行目 | exit | 意味 |
|---|---|---|
| `ADVANCE <phase>` | 0 | ゲート通過(または失敗時ルーティング)。新フェーズの指示が続く |
| `RETRY n[/max] <phase>` | 1 | ゲート失敗。落ちたチェックと出力の末尾が続く |
| `COMPLETE` | 0 | 終点 |
| `ESCALATE <reason>` | 2 | 人間の判断が必要 |
| `ABORT <reason>` | 2 | 中断済み |

exit 3 は設定エラーである。
終了済みの run に対する `next` は冪等で、作業ツリーが無変更のときは前回の判定を再表示するだけなので、様子見の `next` で試行回数が減ることはない。

### ルーティング(workflow.yaml)

| フィールド | 値 | デフォルト |
|---|---|---|
| `on_pass` | フェーズ名、`$end` | なし(必須) |
| `on_fail` | `retry`、フェーズ名、`$end`、`escalate`、`abort` | `retry` |
| `max_attempts` | 正の整数。そのフェーズが最後に通過してからの失敗回数を数える | 無制限 |
| `on_exhausted` | `escalate`、`abort` | `escalate` |
| `limits.max_total_iterations` | 正の整数。全体の暴走防止 | なし |

チェックは CI で見慣れた `- name:` / `run:` / `timeout:` のステップで、`/bin/sh -c` で実行される(最初の失敗でゲートは打ち切り)。
フェーズには `env:` を設定できる。
`needs:` や `if:`、`${{ }}`、matrix、トリガーは意図的に持たない。
ルーティングを決めるのはゲートの pass / fail だけである。
詳細は [docs/adr/0003](docs/adr/0003-workflow-yaml-vocabulary.md) にある。

### バックストップ

スキルは指示であって、強制ではない。
Stop hook が `.headsign/state.json` を読み、run が `running` の間はエージェントの終了をブロックして `headsign next` に差し戻す。
completed、escalated、aborted は正しい終わり方なので、そのまま通す。
hook は fail-open であり(セッションを閉じ込めることはない)、実評価を挟まない差し戻しは連続 3 回でやめる。
詳細は [docs/adr/0006](docs/adr/0006-stop-hook-backstop.md) にある。

## 作らないもの

DAG や並列フェーズ、worktree 隔離、プロバイダ抽象化、ペルソナ、テンプレートや式言語、MCP サーバー、TUI は作らない。
ハーネス側に賢さが必要になったら、それは賢さの置き場所が間違っている。
[docs/adr/0001](docs/adr/0001-thin-harness.md) を参照。

## 開発

```
npm install
npm test          # node:test。テストフレームワークの依存なし
npm run typecheck
npm run build     # esbuild → plugin/dist/headsign.mjs(コミットする成果物)
```

実行には Node 20 以上、開発には Node 22.6 以上が必要である(テストが TypeScript をそのまま実行するため)。
設計判断は [docs/](docs/architecture.md) にまとめてある。

## ライセンス

MIT
