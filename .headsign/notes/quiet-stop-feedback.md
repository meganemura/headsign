# フィードバック原文: Stop hook が「静かに通った」ことが観測できない

headsign を使っている側のプロジェクトから届いた文言。`.headsign/tmp/` は
`headsign start` で消えるので、原文をここに置く。この run
(`design-grilling`) が扱う入力そのもの。

---

## 状況

headsign start から settle までを1セッションで駆動していた。1ターンで複数フェーズ（simplify → challenge → decide）を進め、decide の記録まで終えたところで headsign next を実行せずにターンを終える、という進め方を繰り返していた。

## 観測したこと

Stop hook の nudge が1ターンおきにしか出なかった。

| ターン | nudge |
| --- | --- |
| ユーザー発言後、1周してターン終了 | 出る |
| （nudge を受けて継続）もう1周してターン終了 | 出ない |
| ユーザーが再度発言 → 1周してターン終了 | 出る |

原因は src/stophook.ts の `if (input.stop_hook_active) return { block: false };` でした。Claude Code が無限ループ防止のために立てるフラグを見て黙って通す実装で、これ自体は必須の挙動だと理解しています。

## 何が困ったか

なぜ nudge が出なかったのかを、状態から特定できませんでした。

headsign status は RUNNING decide (attempt 0/5) を返し、フェーズは正しく分かります。しかし「直前の停止が hook を通過したのか、hook がそもそも動いていないのか」は分かりません。

そこで state.json を見ると "stop_nudges": 0 でした。skill のドキュメントには quiet ending の理由として「an exhausted nudge cap」が挙げられているので、このカウンタが0であることを「キャップ切れではない」= 別の原因があると読み、hook の登録状況やプラグイン構成を調べに行きました。実際には stop_hook_active による通過は state にもログにも何も書かないため、カウンタが0なのは当然でした。

.headsign/log にも start と advance の行しかなく、通過の記録は残っていません。

つまり stop_nudges というフィールドが存在することが、かえって誤読を招きました。ドキュメントは quiet ending の理由を4つ挙げていますが、state が露出しているのはそのうち1つだけで、しかも私のケースの原因ではありませんでした。

## 提案

### 1. 通過を log に記録する。理由を区別して。

```
2026-XX-XXTXX:XX:XX+09:00 pass decide reason=stop_hook_active
2026-XX-XXTXX:XX:XX+09:00 nudge decide n=1
2026-XX-XXTXX:XX:XX+09:00 pass decide reason=nudge_cap n=1
2026-XX-XXTXX:XX:XX+09:00 pass decide reason=pause_note
```

ドキュメントが挙げている4つの理由（claim なし / キャップ切れ / pause note / observer）に stop_hook_active を加えて、どれで通ったかが後から読めると、駆動側の自己診断が一発で終わります。

### 2. headsign status に直前の停止の扱いを出す。

```
RUNNING decide (attempt 0/5)
workflow: design-grilling
driver: not delegated yet — no agent has claimed this run
last stop: passed through (stop_hook_active) at 23:06:51
```

この1行があれば、私は state.json を読む必要すらありませんでした。

### 3. ドキュメントの quiet ending の一覧に stop_hook_active を追記する。

現在の一覧（claim なし / キャップ切れ / pause note / HEADSIGN_OBSERVER）に、Claude Code のループ防止フラグによる通過が入っていません。これが実際にはもっとも頻繁に起きる理由だと思われます。あわせて「nudge は実質ユーザー発言1回あたり1度」という運用上の帰結も書かれていると、駆動側が期待値を持てます。

## 運用上の帰結として気づいたこと（仕様変更の要望ではありません）

1ターンで複数フェーズを進める使い方をすると、next の実行忘れを取り逃す窓が構造的に存在します。nudge を受けて継続し、その周回の終わりでまた止まると、そこは黙って通るためです。プラットフォーム側の制約から来るもので headsign 側で塞げるものではないと理解していますが、上記1・2があれば「静かに止まっている」ことに気づく手段にはなります。

## よかった点

headsign status が読み取り専用でゲートを消費しないと明記されているので、状態を調べる行為が run に影響しないと確信して呼べました。原因調査中に next を叩いてリトライを1つ潰す事故が起きなかったのは、この分離のおかげです。
