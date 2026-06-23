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

test("illegal_char エラー: ERROR_PREFIX + 'unsupported characters' + 入力エコー", () => {
  const msg = formatResult("10 + abc", { ok: false, reason: "illegal_char" });
  expect(msg).toContain(ERROR_PREFIX);
  expect(msg).toContain("unsupported characters");
  expect(msg).toContain("Input: `10 + abc`");
});

test("syntax エラー: 構文エラーの理由が出る", () => {
  const msg = formatResult("1 + ", { ok: false, reason: "syntax" });
  expect(msg).toContain(ERROR_PREFIX);
  expect(msg).toContain("not valid arithmetic syntax");
});

test("unknown_symbol エラー: 識別子混入の理由が出る", () => {
  const msg = formatResult("pi + 1", { ok: false, reason: "unknown_symbol" });
  expect(msg).toContain(ERROR_PREFIX);
  expect(msg).toContain("unknown symbols");
});

test("exponent_overflow エラー: 指数上限の説明が出る", () => {
  const msg = formatResult("9 ^ 9 ^ 9", {
    ok: false,
    reason: "exponent_overflow",
  });
  expect(msg).toContain(ERROR_PREFIX);
  expect(msg).toContain("exponent is too large");
  expect(msg).toContain("100");
});

test("result_overflow エラー: 桁数上限の説明が出る", () => {
  const msg = formatResult("2 ^ 60", {
    ok: false,
    reason: "result_overflow",
  });
  expect(msg).toContain(ERROR_PREFIX);
  expect(msg).toContain("result is too large");
  expect(msg).toContain("16 digits");
});

test("div_by_zero エラー: ゼロ除算の説明が出る", () => {
  const msg = formatResult("10 / 0", { ok: false, reason: "div_by_zero" });
  expect(msg).toContain(ERROR_PREFIX);
  expect(msg).toContain("Division by zero");
});

import {
  formatChannelShare,
  formatShareAck,
  formatSlashResponse,
  SHARE_ACTION_ID,
  SHARE_BLOCK_ID,
  SHARE_VALUE_MAX_LEN,
} from "./calc_format";

test("formatSlashResponse 成功: ephemeral + Block Kit (section + Share to channel ボタン)", () => {
  const res = formatSlashResponse("100 + 200", { ok: true, value: 300 });
  expect(res.response_type).toBe("ephemeral");
  expect(res.text).toContain("Answer: *300*");
  expect(res.blocks).toBeDefined();
  expect(res.blocks).toHaveLength(2);

  const section = res.blocks![0] as { type: string; text: { text: string } };
  expect(section.type).toBe("section");
  expect(section.text.text).toContain("Answer: *300*");

  const actions = res.blocks![1] as {
    type: string;
    block_id: string;
    elements: Array<{
      type: string;
      action_id: string;
      text: { text: string };
      value: string;
    }>;
  };
  expect(actions.type).toBe("actions");
  expect(actions.block_id).toBe(SHARE_BLOCK_ID);
  expect(actions.elements).toHaveLength(1);
  const button = actions.elements[0]!;
  expect(button.type).toBe("button");
  expect(button.action_id).toBe(SHARE_ACTION_ID);
  expect(button.text.text).toBe("Share to channel");
  expect(JSON.parse(button.value)).toEqual({ i: "100 + 200", r: 300 });
});

test("formatSlashResponse エラー: text のみで Block Kit なし", () => {
  const res = formatSlashResponse("10 / 0", {
    ok: false,
    reason: "div_by_zero",
  });
  expect(res.response_type).toBe("ephemeral");
  expect(res.text).toContain("Division by zero");
  expect(res.blocks).toBeUndefined();
});

test("formatSlashResponse 入力が SHARE_VALUE_MAX_LEN を超えるとボタンを省略", () => {
  // 入力をあえて長くする (許可文字のみで構成)
  const longInput = "1+".repeat(SHARE_VALUE_MAX_LEN) + "1";
  const res = formatSlashResponse(longInput, { ok: true, value: 42 });
  expect(res.response_type).toBe("ephemeral");
  expect(res.text).toContain("Answer: *42*");
  // blocks は無く、テキスト fallback のみ
  expect(res.blocks).toBeUndefined();
});

test("formatChannelShare: 結果と posted by 表記を含む", () => {
  const msg = formatChannelShare({ i: "100 + 200", r: 300 }, "U12345");
  expect(msg).toContain("Input: `100 + 200`");
  expect(msg).toContain("Answer: *300*");
  expect(msg).toContain("posted by <@U12345>");
});

test("formatShareAck: チャンネル名がある場合は #name を含む", () => {
  expect(formatShareAck("general")).toBe("✅ Shared to #general");
});

test("formatShareAck: チャンネル名が null の場合は汎用メッセージ", () => {
  expect(formatShareAck(null)).toBe("✅ Shared to channel");
});
