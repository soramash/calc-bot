import type { EvalErrorReason, EvalResult } from "./calc_logic";
import { EXPONENT_ABS_LIMIT } from "./calc_logic";

/**
 * Slack に返すメッセージ整形。fetch ハンドラから分離した純関数で、
 * Web Crypto / Workers ランタイム非依存。vitest で単体テスト可能。
 *
 * - エラー時は `EvalErrorReason` ごとに理由を出し分け、ユーザーに
 *   「何が原因で計算できなかったか」を Slack 上で即座に判別できるようにする
 *   (Decision P2-Q1 A のフォローアップ ① ②)。
 * - 成功時は Block Kit のセクション + 「Share to channel」ボタンを返す
 *   (Decision Q4 D / P2-Q3 C)。ボタンの `value` には元の入力と結果を
 *   `{i, r}` の JSON で埋め込む stateless 構成 (Decision P2-Q2 A)。
 *   Slack の `value` は実装上 ~2000 文字までなので、それを超える長い入力は
 *   ボタンを表示せずテキストのみ返すフォールバックを取る (P2-Q2 ノート②)。
 */

export const SUCCESS_PREFIX = "🧮 *Calculation Result*";
export const ERROR_PREFIX = "❌ *Calculation Error*";

const EXAMPLE_HINT = "*Example: /calc (1,000 + 500) * 2^3*";

const ERROR_DETAIL: Record<EvalErrorReason, string> = {
  illegal_char:
    "The expression contains unsupported characters. Allowed: digits, `+ - * / ( ) .`, spaces, and `^`.",
  syntax: "The expression is not valid arithmetic syntax.",
  unknown_symbol:
    "The expression contains unknown symbols. Variables and functions are not supported.",
  exponent_overflow:
    `The exponent is too large. The absolute value of an exponent literal must be ≤ ${EXPONENT_ABS_LIMIT}.`,
  result_overflow:
    "The result is too large. It must fit within ±`Number.MAX_SAFE_INTEGER` (about 16 digits).",
  div_by_zero: "Division by zero is not allowed.",
};

/** Block Kit 識別子。`/slack/interactive` 側で action_id を照合する。 */
export const SHARE_ACTION_ID = "calc_share";
export const SHARE_BLOCK_ID = "calc_actions";

/**
 * Slack の button.value は仕様上 2000 文字以内。JSON 化のオーバーヘッドや
 * 将来の payload 拡張を考慮して安全側に 1900 文字を上限にする。
 */
export const SHARE_VALUE_MAX_LEN = 1900;

/** ボタン `value` に詰めるペイロード。短いキーで JSON サイズを抑える。 */
export interface SharePayload {
  /** 元入力 (i)nput */
  i: string;
  /** 計算結果 (r)esult */
  r: number;
}

export interface SlashCommandResponse {
  response_type: "ephemeral";
  text: string;
  blocks?: ReadonlyArray<Record<string, unknown>>;
}

/**
 * `/calc` の slash command レスポンス本体を組み立てる。
 * - 成功: Block Kit (section + actions[Share to channel]) + fallback text
 * - エラー: text のみ (理由別文言、Block Kit なし)
 * - 成功でも `value` 上限を超える場合はボタン省略 (テキストのみ)
 */
export function formatSlashResponse(
  input: string,
  result: EvalResult,
): SlashCommandResponse {
  const text = formatResult(input, result);
  if (!result.ok) {
    return { response_type: "ephemeral", text };
  }

  const value = JSON.stringify(
    { i: input, r: result.value } satisfies SharePayload,
  );
  if (value.length > SHARE_VALUE_MAX_LEN) {
    // 入力が長すぎてボタン value に収まらない場合はボタンを諦める。
    // 計算結果自体はテキストで届けるので機能性は維持。
    return { response_type: "ephemeral", text };
  }

  return {
    response_type: "ephemeral",
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "actions",
        block_id: SHARE_BLOCK_ID,
        elements: [
          {
            type: "button",
            action_id: SHARE_ACTION_ID,
            text: { type: "plain_text", text: "Share to channel" },
            value,
          },
        ],
      },
    ],
  };
}

/** プレーンテキスト版 (内部利用 + 既存テスト互換)。 */
export function formatResult(input: string, result: EvalResult): string {
  if (result.ok) {
    return `${SUCCESS_PREFIX}\nInput: \`${input}\`\nAnswer: *${result.value}*`;
  }
  return [
    ERROR_PREFIX,
    `Input: \`${input}\``,
    ERROR_DETAIL[result.reason],
    EXAMPLE_HINT,
  ].join("\n");
}

/**
 * 「チャンネルに共有」ボタン押下時、`response_type: in_channel` で
 * チャンネルへ post するメッセージ本文を組み立てる。
 * 元入力者を `posted by <@user_id>` で明示する (Q4 D ノート②)。
 */
export function formatChannelShare(
  payload: SharePayload,
  userId: string,
): string {
  return [
    SUCCESS_PREFIX,
    `Input: \`${payload.i}\``,
    `Answer: *${payload.r}*`,
    `_posted by <@${userId}>_`,
  ].join("\n");
}

/**
 * 共有後に元の ephemeral を `replace_original: true` で差し替える際の
 * メッセージ。「共有済み」状態を ephemeral 側に残してボタン二重押下を
 * 防ぐ (Decision P2-Q3 C)。
 */
export function formatShareAck(channelName: string | null): string {
  return channelName
    ? `✅ Shared to #${channelName}`
    : "✅ Shared to channel";
}
