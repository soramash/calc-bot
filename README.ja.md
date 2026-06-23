> See [README.md](./README.md) for the English version.

# calc-bot

Slack 計算 Bot `/calc` (指数計算対応)。Cloudflare Workers 上で動作し、Slack のスラッシュコマンドを受けて四則演算 / カッコ / 小数 / 指数 (`^`) を安全に計算して ephemeral で返します。

## Prerequisites

- Node.js 20 以上 (推奨 24 系。`mise` などの version manager 経由で OK)
- npm 10 以上
- [Cloudflare アカウント](https://dash.cloudflare.com/)
- Slack ワークスペースの管理権限 (アプリインストール用)

## Setup

```sh
npm install
```

## Local development

```sh
# 全テストを実行 (calc_logic / calc_format / slack_signature / index)
npm test

# 型チェック
npm run typecheck

# Workers をローカル起動 (http://localhost:8787)
npm run dev
```

`npm run dev` は localhost にしか公開されないため、Slack からは到達できません。Slack 連携を試したいときは下の Deploy 手順で Workers にデプロイし、Slack アプリの URL をそちらに向けてください。

> ローカルでも HTTPS で Slack に公開したい場合は [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-tunnel/) や ngrok 等を併用してください。

## Deploy to Cloudflare Workers

```sh
# 初回のみ Cloudflare にログイン
npx wrangler login

# デプロイ。標準出力に Workers URL (https://calc-bot.<subdomain>.workers.dev) が表示される
npm run deploy
```

デプロイ後、ターミナルに表示される URL の末尾に `/slack/calc` を付けたものが Slack アプリに登録するエンドポイントです。例:

```
https://calc-bot.<your-subdomain>.workers.dev/slack/calc
```

## Slack app configuration

1. <https://api.slack.com/apps> を開いて **Create New App** → **From a manifest** を選択
2. 対象ワークスペースを選び、`slack-app-manifest.yaml` の内容を貼り付け
3. `slash_commands[0].url` を上で得た Workers URL (`/slack/calc` 終端) に書き換えて作成
4. 作成されたアプリ画面の **Install App** からワークスペースにインストール
5. **Basic Information → Signing Secret** を Show して値をコピー
6. 値を Workers の secret として設定:

   ```sh
   npx wrangler secret put SLACK_SIGNING_SECRET
   # プロンプトが出るのでコピーした Signing Secret を貼る
   ```

7. ワークスペースの任意のチャンネルで `/calc 100 + 200` と打って ephemeral で `🧮 *Calculation Result* … Answer: *300*` が出れば完了

> 失敗するときは `npx wrangler tail` でリアルタイムログを確認できます。401 が返るときは Signing Secret 設定漏れか、URL の `/slack/calc` パスがズレているかが大半。

## Test cases

`npm test` は以下を全て検証します (合計 25 ケース)。

### 計算コア (PLAN 仕様)

| No | 入力 | 期待 |
|----|------|------|
| 1 | `100 + 200 * 3 - 50` | `650` |
| 2 | `(100 + 200) * 3` | `900` |
| 3 | `10 / 4` | `2.5` |
| 4 | `1,500 + 500` | `2000` |
| 5 | `2 ^ 3` | `8` |
| 6 | `10 + 2 ^ 3 * 5` | `50` |
| 7 | `10 / 0` | エラー (`div_by_zero`) |
| 8 | `10 + abc / window.alert()` | エラー (`illegal_char`) |

### 追加ケース

| No | 入力 | 期待 |
|----|------|------|
| 9 | `-2 ^ 3` | `-8` |
| 10 | `9 ^ 9 ^ 9` | エラー (`exponent_overflow`) |
| 11 | `2 ^ 60` | エラー (`result_overflow`) |
| 12 | `(1+2)*((3+4))` | `21` |

加えて Slack 署名検証 4 ケースと fetch ハンドラ 5 ケース (正常系・エラー系・無効署名 401・GET 404・他パス 404) も自動で確認されます。

## Limitations & roadmap

### Cloudflare Workers 無料枠

- リクエスト: **アカウント全体で 100,000 / 日** (既存 Worker と合算)
- CPU 時間: 10ms / リクエスト (calc-bot は実測 2-5ms)
- バンドル: 3 MB (calc-bot は ~50 KB)

参考: [Workers の制限](https://developers.cloudflare.com/workers/platform/limits/)

### セキュリティ

- 数式評価は `expr-eval` の AST を経由 (`eval()` 不使用)
- 文字ホワイトリスト + 識別子混入検出 + 指数値リテラル制限 (絶対値 ≤ 100) + 結果範囲制限 (`Number.MAX_SAFE_INTEGER`) で多段ガード
- Slack 署名検証は HMAC-SHA256 + 5 分の timestamp tolerance + constant-time 比較

### Roadmap

#### Phase 2 — チャンネル共有

現在スコープイン中の機能。Decision Q4 D と `PLAN.md` の `P2-Q*` 行を参照。

- ephemeral 結果に Block Kit の「チャンネルに共有」ボタンを追加
- 押下するとチャンネルに `in_channel` で同じ計算結果を投稿し、元の ephemeral は `replace_original: true` で `✅ Shared to #channel` に差し替え
- ボタンの `value` に元入力と結果を埋め込む stateless 構成（KV 不要）

#### Phase 3 — 数値範囲の拡張 (先送り)

- BigInt 対応と桁区切り表示
- 現状の上限は `Number.MAX_SAFE_INTEGER` (整数で約 16 桁)。12 桁までは問題なく扱えるため緊急性は低く、Decision P2-Q1 A で Phase 2 からは明示的に除外

## Project layout

```
.
├── package.json          # npm scripts と依存
├── wrangler.jsonc        # Cloudflare Workers 設定
├── tsconfig.json         # TypeScript 設定
├── vitest.config.ts      # テスト設定
├── slack-app-manifest.yaml  # Slack app manifest (Slack に貼り付ける YAML)
├── src/
│   ├── index.ts          # Workers fetch ハンドラ (Slack 受信 → 計算 → ephemeral 返却)
│   ├── index.test.ts     # ハンドラ統合テスト
│   ├── slack_signature.ts       # HMAC-SHA256 署名検証 (Web Crypto API)
│   ├── slack_signature.test.ts
│   ├── calc_logic.ts     # 数式評価コア (expr-eval AST + ガード)
│   ├── calc_logic.test.ts
│   ├── calc_format.ts    # Slack メッセージ整形
│   └── calc_format.test.ts
├── PLAN.md               # 設計と意思決定の記録 (Decisions テーブル含む)
└── README.md             # このファイル
```
