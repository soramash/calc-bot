import type { EvalResult } from "./calc_logic";

/**
 * Slack に返すメッセージ整形。fetch ハンドラから分離した純関数で、
 * Web Crypto / Workers ランタイム非依存。vitest で単体テスト可能。
 */

export const SUCCESS_PREFIX = "🧮 *Calculation Result*";
export const ERROR_PREFIX = "❌ *Calculation Error*";

export function formatResult(input: string, result: EvalResult): string {
  if (result.ok) {
    return `${SUCCESS_PREFIX}\nInput: \`${input}\`\nAnswer: *${result.value}*`;
  }
  return `${ERROR_PREFIX}\nThe expression is invalid or contains unsupported characters.\n*Example: /calc (1,000 + 500) * 2^3*`;
}
