import { expect, test } from "vitest";
import {
  computeSlackSignature,
  verifySlackSignature,
} from "./slack_signature";

const SECRET = "test-secret";
const FIXED_NOW = 1_700_000_000;
const now = () => FIXED_NOW;

async function makeValidSignature(rawBody: string, ts: number = FIXED_NOW) {
  return await computeSlackSignature({
    signingSecret: SECRET,
    timestamp: String(ts),
    rawBody,
  });
}

test("有効な署名とタイムスタンプ → true", async () => {
  const rawBody = "text=100+%2B+200&command=%2Fcalc";
  const signature = await makeValidSignature(rawBody);
  const ok = await verifySlackSignature({
    signingSecret: SECRET,
    timestamp: String(FIXED_NOW),
    rawBody,
    signature,
    now,
  });
  expect(ok).toBe(true);
});

test("body が改ざんされている → false", async () => {
  const original = "text=100+%2B+200";
  const signature = await makeValidSignature(original);
  const tampered = "text=999+%2B+999";
  const ok = await verifySlackSignature({
    signingSecret: SECRET,
    timestamp: String(FIXED_NOW),
    rawBody: tampered,
    signature,
    now,
  });
  expect(ok).toBe(false);
});

test("timestamp が古すぎる (replay) → false", async () => {
  const rawBody = "text=1+%2B+1";
  const oldTs = FIXED_NOW - 600; // 10 分前、tolerance 300 を超える
  const signature = await makeValidSignature(rawBody, oldTs);
  const ok = await verifySlackSignature({
    signingSecret: SECRET,
    timestamp: String(oldTs),
    rawBody,
    signature,
    now,
  });
  expect(ok).toBe(false);
});

test("signature ヘッダー値が一致しない → false", async () => {
  const rawBody = "text=1+%2B+1";
  const ok = await verifySlackSignature({
    signingSecret: SECRET,
    timestamp: String(FIXED_NOW),
    rawBody,
    signature: "v0=" + "0".repeat(64),
    now,
  });
  expect(ok).toBe(false);
});
