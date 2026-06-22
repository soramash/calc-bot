import { expect, test } from "vitest";
import { ERROR_PREFIX, formatResult, SUCCESS_PREFIX } from "./calc_format";

test("整数結果のフォーマット", () => {
  const msg = formatResult("100 + 200", { ok: true, value: 300 });
  expect(msg).toContain(SUCCESS_PREFIX);
  expect(msg).toContain("Input: `100 + 200`");
  expect(msg).toContain("Answer: *300*");
});

test("小数結果のフォーマット", () => {
  const msg = formatResult("10 / 4", { ok: true, value: 2.5 });
  expect(msg).toContain(SUCCESS_PREFIX);
  expect(msg).toContain("Answer: *2.5*");
});

test("illegal_char エラーのフォーマット", () => {
  const msg = formatResult("10 + abc", { ok: false, reason: "illegal_char" });
  expect(msg).toContain(ERROR_PREFIX);
  expect(msg).toContain("unsupported characters");
});

test("div_by_zero エラーのフォーマット", () => {
  const msg = formatResult("10 / 0", { ok: false, reason: "div_by_zero" });
  expect(msg).toContain(ERROR_PREFIX);
});
