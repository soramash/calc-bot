# 📝 Slack計算Bot「@calc」開発要件・詳細仕様書（指数計算対応版）

## 1. 概要

Slackの次世代プラットフォーム（Automation）を活用し、外部サーバー（AWS等）を構築することなく、Slackインフラ上で動作する四則演算および指数計算が可能なBot（スラッシュコマンド形式）を開発する。

## 2. 要件定義（Requirements）

### ① 機能要件

- **数式の評価・計算**: ユーザーが入力した数式を正しく計算し、結果をSlackに返却すること。
- **対応する計算の種類**:
  - 四則演算（`+`, `-`, `*`, `/`）
  - カッコを用いた優先計算（`(`, `)`）
  - 小数点を含む計算（`.`）
  - 指数計算・べき乗（`^` または `**`）
- **セキュリティ（安全な計算）**: 悪意あるコードの実行（インジェクション攻撃）を防ぐため、JavaScriptの `eval()` などを直接使用せず、安全に数式をパースして計算すること。
- **エラーハンドリング**: 不正な数式やゼロ除算（例: `10 / 0`）が入力された場合、Botがクラッシュせず、ユーザーに分かりやすいエラーメッセージを返すこと。

### ② 非機能要件

- **実行環境**: Slack 次世代プラットフォーム（Deno / TypeScript）
- **コスト**: Slackのホスト環境（無料枠内）で動作させ、外部インフラコストを 0 円に抑えること。
- **応答速度**: ユーザーの入力から 3 秒以内に計算結果をレスポンスすること（Slack APIのタイムアウト制約に基づく）。

## 3. 詳細仕様（Technical Specifications）

### ① インタフェース仕様

- **呼び出し方法**: スラッシュコマンド `/calc [数式]`
- **入力パラメータ**: `text` (String型, 例: `(1,000 + 500) * 2 ^ 3`)

### ② 数式パース・計算ロジック（重要）

安全かつ正確な計算のため、以下のステップで処理を行う。

1. **カンマの除去**: 金額表記等で入力される可能性があるカンマ（`,`）は、計算前に自動で除去またはスペースに置換する（例: `1,500` ➔ `1500`）。
2. **サニタイズ（ホワイトリスト形式）**: 使用を許可する文字を `0-9`, `+`, `-`, `*`, `/`, `(`, `)`, `.`, `^`, ` `（スペース） のみに制限し、それ以外の文字が含まれる場合は一律エラーとする。
3. **指数記号の置換**: 一般ユーザーにとって直感的な指数記号 `^` を、JavaScript標準のべき乗演算子 `**` に置換する（例: `2^3` ➔ `2**3`）。
4. **安全な評価エンジン**: Deno環境で動作する軽量な数式パースライブラリ（例: `expr-eval` や `mathjs` のDeno互換版）を使用するか、正規表現による厳密なバリデーションを経た上で `Function("use strict"; return ...)` を実行して評価する。

### ③ 出力（レスポンス）仕様

計算結果は、リクエストを送信したユーザーへの「エフェメラルメッセージ（自分だけに表示）」として返却する（チャンネル全体のログを汚さないため）。

**正常系メッセージ（フォーマット）**

```
🧮 計算結果
入力: ${入力された数式}
答え: ${計算結果}
```

**異常系メッセージ（フォーマット）**

```
❌ 計算エラー
入力された数式に誤りがあるか、計算できない文字列が含まれています。
例: /calc (100 + 200) * 2 ^ 3
```

## 4. 実装コードの構成案（エンジニア向け）

### プロジェクト構造

```
.slack/
manifest.ts             # アプリのメタデータ、権限、コマンドの定義
functions/
  └ calc_function.ts    # 計算ロジック本体（TypeScript / Deno）
workflows/
  └ calc_workflow.ts    # コマンドからFunctionを呼び出すワークフロー定義
```

### ロジックの実装コード例（`functions/calc_function.ts`）

```typescript
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

export const CalcFunctionDefinition = DefineFunction({
  callback_id: "calc_function",
  title: "計算ロジック",
  source_file: "functions/calc_function.ts",
  input_parameters: {
    properties: { text: { type: Schema.types.string } },
    required: ["text"],
  },
  output_parameters: {
    properties: { result: { type: Schema.types.string } },
    required: ["result"],
  },
});

export default SlackFunction(CalcFunctionDefinition, ({ inputs }) => {
  try {
    let inputStr = inputs.text;

    // 1. カンマの除去
    inputStr = inputStr.replace(/,/g, "");

    // 2. ホワイトリストによるサニタイズ (数字、四則演算子、カッコ、ピリオド、スペース、ハット)
    if (/[^0-9+\-*/().\s^]/.test(inputStr)) {
      throw new Error("Invalid characters");
    }

    // 3. 指数記号「^」をJavaScriptの「**」に置換
    const validExpression = inputStr.replace(/\^/g, "**");

    // 4. 安全なコンテキストでの評価
    const mathResult = Function(`"use strict"; return (${validExpression})`)();

    if (mathResult === null || mathResult === undefined || isNaN(mathResult) || !isFinite(mathResult)) {
      throw new Error("Invalid calculation results");
    }

    return { outputs: { result: `🧮 **計算結果**\n入力: \`${inputs.text}\`\n答え: **${mathResult}**` } };
  } catch (error) {
    return {
      outputs: {
        result: "❌ **計算エラー**\n入力された数式に誤りがあるか、計算できない文字列が含まれています。\n*例: /calc (1,000 + 500) * 2^3*"
      }
    };
  }
});
```

## 5. テストケース（必須確認パターン）

| No | テスト内容 | 入力値（例） | 期待される出力 | 備考 |
|----|-----------|-------------|---------------|------|
| 1 | 基本的な四則演算 | `100 + 200 * 3 - 50` | `650` | 演算子の優先順位通り |
| 2 | カッコを含む計算 | `(100 + 200) * 3` | `900` | カッコ内が優先されること |
| 3 | 小数点の計算 | `10 / 4` | `2.5` | 小数点表記 |
| 4 | カンマ付き文字 | `1,500 + 500` | `2000` | カンマが除去され正常処理 |
| 5 | 指数計算（単体） | `2 ^ 3` | `8` | 2の3乗の計算 |
| 6 | 指数と四則演算の混合 | `10 + 2 ^ 3 * 5` | `50` | 指数・掛け算が優先（10 + 40） |
| 7 | ゼロ除算（エラー） | `10 / 0` | エラーメッセージ | インフィニティ（Infinity）エラーを回避 |
| 8 | 不正な文字列（エラー） | `10 + abc / window.alert()` | エラーメッセージ | スクリプトの実行を完全に遮断 |


## Decisions

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| Q1 プラットフォーム前提 | A: 現行 `deno-slack-sdk` + ROSI のまま完成 → **B: Slack Bolt + Cloudflare Workers (free tier) に切替** | 仕様再定義のコストを避け、当初の「Slack 次世代プラットフォーム」前提を維持。Bolt + Workers / Lambda への移植は本要件のスコープ外と判断 → **Phase 1 実装中に Slack 次世代プラットフォームでは slash command が first-class trigger として存在しないことが判明（trigger は link / scheduled / event / webhook の 4 種のみ）。PLAN のインタフェース仕様 `/calc` を維持するため Cloudflare Workers + classic Slack app に方針変更。** | フォローアップ: ① CLI から deno 同梱が外れたため、ローカル/CI で deno を別途インストールする手順を README に追記 ② ROSI 無料枠の境界（呼び出し回数・実行時間）と将来の廃止アナウンスを定期ウォッチ → **新方針 (B) のフォローアップ**: ① Workers 無料枠 100,000 リクエスト/日（**アカウント全体で共有**）、CPU 10ms/呼び出し、bundle 3MB を確認済み ② Slack app は classic 形式で api.slack.com/apps から手動作成、`features.slash_commands` で Workers URL を指定 ③ 既存の `calc_logic.ts` / `calc_format.ts` は pure TS でそのまま流用可能。`manifest.ts` / `deno.jsonc` / `.slack/` / `calc_function.ts` (deno-slack-sdk 固有) は破棄 |
| Q2 評価エンジンと DoS 対策 | D: `expr-eval` ベースの AST 評価 ＋ 単項マイナスの前処理 | 巨大べき乗 (`9^9^9^9`) による 3 秒応答超過と JS の `-2 ** 3` SyntaxError を最小コストで両方潰せる | フォローアップ: ① Deno 互換の `expr-eval` (もしくは同等) を 1 つに選定 ② 指数の絶対値上限（暫定 ≤ 100）と結果上限 (`Number.MAX_SAFE_INTEGER` 超でエラー) を定数化 ③ 単項マイナスはライブラリ仕様に応じて前処理要否を確認 / **Spike 結果 (Todo 1)**: 採用 = `npm:expr-eval@2.0.2`（mathjs は依存 10+ で過剰）。`-2 ^ 3 = -8` を expr-eval / mathjs ともに正しく扱うため**単項マイナス前処理は不要**。`variables()` API で不明識別子を検出可能。AST は RPN トークン配列で `IOP2 ^` 直前の `INUMBER` トークンが指数値となる |
| Q3 数値精度・表示 | A: `Number` のまま、安全範囲外（>2^53 / `Infinity` / `NaN`）はエラー扱い | 誤った答えを返さないことを最優先、実装最小。BigInt と桁区切り整形は本要件のスコープ外 | フォローアップ: ① エラー文言で「桁が大きすぎます」など範囲超過時の理由を出し分けるか別途検討 ② 将来 BigInt 対応する場合の境界（整数のみ等）をメモ |
| Q4 レスポンスの可視範囲 | D: デフォルト ephemeral ＋ Block Kit の「チャンネルに共有」ボタン | チャンネル汚染を抑えつつ共有 UX を確保。サブコマンド方式 (C) より入力負荷が少ない | フォローアップ: ① Block Kit `actions` ブロックの button + interactive 用 function/workflow を別途設計 ② 共有時のメッセージは元の入力者を `posted by @user` で明示 ③ ボタン押下時のリトライ/失敗ハンドリング |
| **P2-Q1** Phase 2 における BigInt 対応の扱い | A: Phase 2 から完全に外す（Decision Q3 A の方針を維持） | 評価エンジン据え置きで追加依存ゼロ・bundle / CPU リスクなし。`MAX_SAFE_INTEGER` 超過は実用上低頻度で、エラー文言を改善する方が UX 改善幅が大きい | フォローアップ: ① `result_overflow` の Slack 文言を「桁が大きすぎます (絶対値が 2^53 を超える結果)」のように理由を明示する分岐に変更 ② `exponent_overflow` も「指数が大きすぎます (絶対値 ≤ 100 まで)」と明文化 ③ README / PLAN.md の Roadmap (Phase 2) 節から BigInt と桁区切りの記述を削除し、別 Roadmap (例: Phase 3) として分離して残す |
| **P2-Q2** 共有ボタン押下時の元入力・結果の持ち回し | A: ボタンの `value` に `{input, result}` を JSON で埋め込む (stateless) | KV 追加なしで Free tier を維持し、実装最小。Slack の `value` 上限 (約 2000 文字) は `/calc` 入力長として実用上ほぼ収まる | フォローアップ: ① ペイロード構造を `{i: "<input>", r: <number>}` のような短いキーで設計し JSON エンコード後の長さに余裕を持たせる ② 入力長が `value` 上限を超えるケースのフォールバック (ボタンを表示しない / 結果のみ表示する) を要件化 ③ 署名検証は既存 `slack_signature.ts` がそのまま使える (interaction も同じ HMAC `v0:{ts}:{rawBody}` 仕様) ことを実装で確認 |
| **P2-Q3** 共有後の UI 挙動 | C: チャンネルに `in_channel` 投稿しつつ、ephemeral は `replace_original: true` で `✅ Shared to #channel` に差し替え | 「共有済み」状態が ephemeral 側に明示されボタン二重押下を抑止できる。チャンネル側にも結果が残り元投稿者の文脈は別途明示する | フォローアップ: ① interaction handler は (a) 共有先チャンネルへ `in_channel` メッセージを post、(b) 元の `response_url` に `replace_original: true` で差替メッセージを送信、の 2 リクエストを順序保証して投げる ② 共有メッセージ本文に `posted by <@user_id>` を含めて元入力者を明示 ③ 差替後の ephemeral からは Block Kit のボタンを除去し UI 側でも二重押下を不能化 ④ 2 リクエストのうち片方が失敗した場合の挙動 (ロールバック有無 / ユーザーへの通知) を要件化 |
| **P2-Q4** Phase 2 リリース戦略 | A: 共有ボタン + BigInt をまとめて 1 PR | 1 サイクルでまとめる方針（指定どおり） | 注意: P2-Q1 A により BigInt は Phase 2 から除外されたため、本選択は実質「共有ボタン単体を 1 PR で出す」と等価。フォローアップ: ① README / PLAN.md の "Roadmap (Phase 2)" を「共有ボタンのみ」に書き換え ② Slack manifest の `interactivity.is_enabled` を `true` に変更し Request URL (`/slack/interactive` 等) を追加 ③ Workers のルーティングに interactive endpoint を追加し既存の `/slack/calc` と統合 |

