import { expect, test } from "vitest";
import { type EvalResult, evaluate } from "./calc_logic";

function expectOk(r: EvalResult, expected: number): void {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.reason}`);
  expect(r.value).toBe(expected);
}

function expectErr(r: EvalResult, reason: string): void {
  if (r.ok) throw new Error(`expected error '${reason}', got value: ${r.value}`);
  expect(r.reason).toBe(reason);
}

// PLAN テストケース #1-#8

test("PLAN #1 基本的な四則演算", () => {
  expectOk(evaluate("100 + 200 * 3 - 50"), 650);
});

test("PLAN #2 カッコを含む計算", () => {
  expectOk(evaluate("(100 + 200) * 3"), 900);
});

test("PLAN #3 小数点の計算", () => {
  expectOk(evaluate("10 / 4"), 2.5);
});

test("PLAN #4 カンマ付き文字", () => {
  expectOk(evaluate("1,500 + 500"), 2000);
});

test("PLAN #5 指数計算 (単体)", () => {
  expectOk(evaluate("2 ^ 3"), 8);
});

test("PLAN #6 指数と四則演算の混合", () => {
  expectOk(evaluate("10 + 2 ^ 3 * 5"), 50);
});

test("PLAN #7 ゼロ除算", () => {
  expectErr(evaluate("10 / 0"), "div_by_zero");
});

test("PLAN #8 不正な文字列 (識別子混入)", () => {
  expectErr(evaluate("10 + abc / window.alert()"), "illegal_char");
});

// 追加テストケース #9-#12

test("追加 #9 単項マイナスとべき乗 (-2^3 = -8)", () => {
  // Spike 知見: expr-eval は `(-(2 ^ 3))` と解釈するので前処理不要
  expectOk(evaluate("-2 ^ 3"), -8);
});

test("追加 #10 ネスト指数で DoS 遮断 (9^9^9)", () => {
  // 外側の ^ の指数側が computed なので保守ガードで拒否
  expectErr(evaluate("9 ^ 9 ^ 9"), "exponent_overflow");
});

test("追加 #11 結果が安全範囲を超える指数 (2^60)", () => {
  // 指数 60 はリテラル制限 100 以下で通過するが、結果は MAX_SAFE_INTEGER 超
  expectErr(evaluate("2 ^ 60"), "result_overflow");
});

test("追加 #12 ネストカッコ (1+2)*((3+4)) = 21", () => {
  expectOk(evaluate("(1+2)*((3+4))"), 21);
});
