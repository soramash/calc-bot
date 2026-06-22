import { Parser } from "expr-eval";

/**
 * 数式評価コア。Slack 連携から分離して純関数として提供する。
 *
 * 設計:
 *   1. 入力からカンマを除去 (`1,500` → `1500`)
 *   2. 文字ホワイトリスト (`0-9 + - * / ( ) . space ^`) 以外があれば illegal_char で拒否
 *   3. expr-eval でパース。識別子が混入していたら unknown_symbol で拒否
 *   4. RPN トークン列を走査し、べき乗 (IOP2 `^`) の指数オペランドが
 *      数値リテラル (INUMBER) でなければ exponent_overflow で拒否
 *      （ネスト指数 `9^9^9` の DoS を遮断するための保守的なガード）
 *   5. 数値リテラルなら絶対値 ≤ EXPONENT_ABS_LIMIT を要求
 *   6. 評価結果が NaN または Infinity で、かつトークン列に literal `/0` が
 *      あれば div_by_zero、それ以外は result_overflow
 *   7. 最終値は Number.isFinite かつ |value| ≤ Number.MAX_SAFE_INTEGER に制限
 *
 * Spike (Todo 1) の知見により、expr-eval は `-2 ^ 3 = -8` を正しく扱うため
 * 単項マイナスの前処理は不要。
 */

export const EXPONENT_ABS_LIMIT = 100;

export type EvalErrorReason =
  | "illegal_char"
  | "syntax"
  | "unknown_symbol"
  | "exponent_overflow"
  | "result_overflow"
  | "div_by_zero";

export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; reason: EvalErrorReason };

interface Token {
  type: string;
  value: number | string;
}

const ALLOWED_CHAR_RE = /^[0-9+\-*/().\s^]+$/;

const parser = new Parser();

export function evaluate(input: string): EvalResult {
  const stripped = input.replace(/,/g, "");

  if (!ALLOWED_CHAR_RE.test(stripped)) {
    return { ok: false, reason: "illegal_char" };
  }

  let expr;
  try {
    expr = parser.parse(stripped);
  } catch {
    return { ok: false, reason: "syntax" };
  }

  if (expr.variables().length > 0) {
    return { ok: false, reason: "unknown_symbol" };
  }

  const tokens = (expr as unknown as { tokens: readonly Token[] }).tokens;

  const exponentGuard = checkExponentLimits(tokens);
  if (exponentGuard) return exponentGuard;

  let value: number;
  try {
    value = expr.evaluate();
  } catch {
    return { ok: false, reason: "syntax" };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      reason: hasLiteralDivByZero(tokens) ? "div_by_zero" : "result_overflow",
    };
  }
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    return { ok: false, reason: "result_overflow" };
  }

  return { ok: true, value };
}

function checkExponentLimits(
  tokens: readonly Token[],
): { ok: false; reason: "exponent_overflow" } | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t || t.type !== "IOP2" || t.value !== "^") continue;
    const prev = tokens[i - 1];
    if (!prev || prev.type !== "INUMBER" || typeof prev.value !== "number") {
      return { ok: false, reason: "exponent_overflow" };
    }
    if (Math.abs(prev.value) > EXPONENT_ABS_LIMIT) {
      return { ok: false, reason: "exponent_overflow" };
    }
  }
  return null;
}

function hasLiteralDivByZero(tokens: readonly Token[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t || t.type !== "IOP2" || t.value !== "/") continue;
    const prev = tokens[i - 1];
    if (prev && prev.type === "INUMBER" && prev.value === 0) {
      return true;
    }
  }
  return false;
}
