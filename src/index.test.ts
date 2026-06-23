import { afterEach, beforeEach, expect, test, vi } from "vitest";
import worker, { type Env } from "./index";
import {
  SHARE_ACTION_ID,
  SHARE_BLOCK_ID,
  type SharePayload,
} from "./calc_format";
import { computeSlackSignature } from "./slack_signature";

const SECRET = "test-secret";
const env: Env = { SLACK_SIGNING_SECRET: SECRET };

// グローバル fetch を毎テスト前にモックし、response_url への POST 内容を検証する。
// 戻り値は何でも良いので空 200 を返す。
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function postSlack(
  pathname: string,
  formBody: Record<string, string>,
  opts: { tamperSignature?: boolean; method?: string } = {},
): Promise<Response> {
  const rawBody = new URLSearchParams(formBody).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = opts.tamperSignature
    ? "v0=" + "0".repeat(64)
    : await computeSlackSignature({
      signingSecret: SECRET,
      timestamp: ts,
      rawBody,
    });
  const request = new Request(`https://example.com${pathname}`, {
    method: opts.method ?? "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": ts,
      "X-Slack-Signature": signature,
    },
    body: opts.method === "GET" ? undefined : rawBody,
  });
  return await worker.fetch(request, env);
}

// ---------- Slash command ----------

test("POST /slack/calc 正常系: text=100+200 → ephemeral 200 + Block Kit ボタン付き", async () => {
  const res = await postSlack("/slack/calc", { text: "100 + 200" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    response_type: string;
    text: string;
    blocks?: Array<Record<string, unknown>>;
  };
  expect(body.response_type).toBe("ephemeral");
  expect(body.text).toContain("🧮");
  expect(body.text).toContain("Answer: *300*");
  expect(Array.isArray(body.blocks)).toBe(true);
  expect(body.blocks).toHaveLength(2);

  const actions = body.blocks![1] as {
    type: string;
    block_id: string;
    elements: Array<{ action_id: string; value: string }>;
  };
  expect(actions.type).toBe("actions");
  expect(actions.block_id).toBe(SHARE_BLOCK_ID);
  expect(actions.elements[0]!.action_id).toBe(SHARE_ACTION_ID);
});

test("POST /slack/calc エラー系: text=10/0 → ephemeral 200 でエラーメッセージ (blocks なし)", async () => {
  const res = await postSlack("/slack/calc", { text: "10 / 0" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    response_type: string;
    text: string;
    blocks?: unknown;
  };
  expect(body.response_type).toBe("ephemeral");
  expect(body.text).toContain("❌");
  expect(body.blocks).toBeUndefined();
});

test("POST /slack/calc 無効な署名 → 401", async () => {
  const res = await postSlack(
    "/slack/calc",
    { text: "1 + 1" },
    { tamperSignature: true },
  );
  expect(res.status).toBe(401);
});

test("GET /slack/calc → 404 (POST 以外は受け付けない)", async () => {
  const res = await postSlack("/slack/calc", { text: "1" }, { method: "GET" });
  expect(res.status).toBe(404);
});

test("POST /other-path → 404", async () => {
  const res = await postSlack("/other", { text: "1" });
  expect(res.status).toBe(404);
});

// ---------- Interactive (Share to channel) ----------

const RESPONSE_URL = "https://hooks.slack.com/actions/T1/B1/abc";

function blockActionsBody(overrides: Record<string, unknown> = {}): {
  payload: string;
} {
  const share: SharePayload = { i: "100 + 200", r: 300 };
  const payload = {
    type: "block_actions",
    user: { id: "U12345" },
    channel: { name: "general" },
    response_url: RESPONSE_URL,
    actions: [
      {
        action_id: SHARE_ACTION_ID,
        value: JSON.stringify(share),
      },
    ],
    ...overrides,
  };
  return { payload: JSON.stringify(payload) };
}

test("POST /slack/interactive 正常系: response_url に in_channel と replace_original を 2 回 POST", async () => {
  const res = await postSlack("/slack/interactive", blockActionsBody());
  expect(res.status).toBe(200);

  expect(fetchMock).toHaveBeenCalledTimes(2);

  const [url1, init1] = fetchMock!.mock.calls[0]!;
  expect(url1).toBe(RESPONSE_URL);
  const body1 = JSON.parse((init1 as RequestInit).body as string);
  expect(body1.response_type).toBe("in_channel");
  expect(body1.replace_original).toBe(false);
  expect(body1.text).toContain("Answer: *300*");
  expect(body1.text).toContain("posted by <@U12345>");

  const [url2, init2] = fetchMock!.mock.calls[1]!;
  expect(url2).toBe(RESPONSE_URL);
  const body2 = JSON.parse((init2 as RequestInit).body as string);
  expect(body2.replace_original).toBe(true);
  expect(body2.text).toBe("✅ Shared to #general");
});

test("POST /slack/interactive 無効な署名 → 401 (response_url へ POST しない)", async () => {
  const res = await postSlack(
    "/slack/interactive",
    blockActionsBody(),
    { tamperSignature: true },
  );
  expect(res.status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("POST /slack/interactive payload 欠落 → 400", async () => {
  const res = await postSlack("/slack/interactive", { other: "x" });
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("POST /slack/interactive payload が JSON でない → 400", async () => {
  const res = await postSlack("/slack/interactive", { payload: "not-json{" });
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("POST /slack/interactive 不一致な action_id → 400", async () => {
  const body = blockActionsBody({
    actions: [{ action_id: "wrong", value: '{"i":"1","r":1}' }],
  });
  const res = await postSlack("/slack/interactive", body);
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("POST /slack/interactive value が JSON でない → 400", async () => {
  const body = blockActionsBody({
    actions: [{ action_id: SHARE_ACTION_ID, value: "not-json" }],
  });
  const res = await postSlack("/slack/interactive", body);
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("POST /slack/interactive value の型が想定と違う → 400", async () => {
  const body = blockActionsBody({
    actions: [
      { action_id: SHARE_ACTION_ID, value: '{"i":123,"r":"oops"}' },
    ],
  });
  const res = await postSlack("/slack/interactive", body);
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("POST /slack/interactive チャンネル名が無い場合は汎用 ack", async () => {
  const body = blockActionsBody({ channel: undefined });
  const res = await postSlack("/slack/interactive", body);
  expect(res.status).toBe(200);

  const [, init2] = fetchMock!.mock.calls[1]!;
  const body2 = JSON.parse((init2 as RequestInit).body as string);
  expect(body2.text).toBe("✅ Shared to channel");
});
