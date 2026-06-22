import { expect, test } from "vitest";
import worker, { type Env } from "./index";
import { computeSlackSignature } from "./slack_signature";

const SECRET = "test-secret";
const env: Env = { SLACK_SIGNING_SECRET: SECRET };

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

test("POST /slack/calc 正常系: text=100+200 → ephemeral 200 で 300 を返す", async () => {
  const res = await postSlack("/slack/calc", { text: "100 + 200" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { response_type: string; text: string };
  expect(body.response_type).toBe("ephemeral");
  expect(body.text).toContain("🧮");
  expect(body.text).toContain("Answer: *300*");
});

test("POST /slack/calc エラー系: text=10/0 → ephemeral 200 でエラーメッセージ", async () => {
  const res = await postSlack("/slack/calc", { text: "10 / 0" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { response_type: string; text: string };
  expect(body.response_type).toBe("ephemeral");
  expect(body.text).toContain("❌");
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
