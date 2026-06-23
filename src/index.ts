import { evaluate } from "./calc_logic";
import {
  formatChannelShare,
  formatShareAck,
  formatSlashResponse,
  SHARE_ACTION_ID,
  type SharePayload,
} from "./calc_format";
import { verifySlackSignature } from "./slack_signature";

export interface Env {
  SLACK_SIGNING_SECRET: string;
}

const SLASH_COMMAND_PATH = "/slack/calc";
const INTERACTIVE_PATH = "/slack/interactive";

/**
 * Slack の block_actions interactive payload (関心のあるフィールドのみ)。
 * https://api.slack.com/interactivity/handling#payloads
 */
interface BlockActionsPayload {
  type?: string;
  user?: { id?: string };
  channel?: { name?: string };
  response_url?: string;
  actions?: ReadonlyArray<{
    action_id?: string;
    value?: string;
  }>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }
    const url = new URL(request.url);
    if (url.pathname === SLASH_COMMAND_PATH) {
      return handleSlashCommand(request, env);
    }
    if (url.pathname === INTERACTIVE_PATH) {
      return handleInteractive(request, env);
    }
    return new Response("Not Found", { status: 404 });
  },
};

async function handleSlashCommand(
  request: Request,
  env: Env,
): Promise<Response> {
  const rawBody = await request.text();
  if (!(await verifyRequest(request, env, rawBody))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const text = new URLSearchParams(rawBody).get("text") ?? "";
  const result = evaluate(text);
  return Response.json(formatSlashResponse(text, result));
}

async function handleInteractive(
  request: Request,
  env: Env,
): Promise<Response> {
  const rawBody = await request.text();
  if (!(await verifyRequest(request, env, rawBody))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payloadStr = new URLSearchParams(rawBody).get("payload");
  if (!payloadStr) {
    return new Response("Bad Request", { status: 400 });
  }

  let payload: BlockActionsPayload;
  try {
    payload = JSON.parse(payloadStr) as BlockActionsPayload;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const action = payload.actions?.[0];
  if (
    payload.type !== "block_actions" ||
    !payload.response_url ||
    !action ||
    action.action_id !== SHARE_ACTION_ID ||
    typeof action.value !== "string"
  ) {
    return new Response("Bad Request", { status: 400 });
  }

  const share = parseSharePayload(action.value);
  if (!share) {
    return new Response("Bad Request", { status: 400 });
  }

  const userId = payload.user?.id ?? "unknown";
  const channelName = payload.channel?.name ?? null;

  // Decision P2-Q3 C: ① チャンネルへ in_channel post → ② 元 ephemeral を replace_original。
  // 順序を保証するため逐次実行。response_url は同一 URL に対し最大 5 回まで POST 可能。
  await postToResponseUrl(payload.response_url, {
    response_type: "in_channel",
    replace_original: false,
    text: formatChannelShare(share, userId),
  });
  await postToResponseUrl(payload.response_url, {
    replace_original: true,
    text: formatShareAck(channelName),
  });

  return new Response("", { status: 200 });
}

async function verifyRequest(
  request: Request,
  env: Env,
  rawBody: string,
): Promise<boolean> {
  return verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    timestamp: request.headers.get("X-Slack-Request-Timestamp") ?? "",
    rawBody,
    signature: request.headers.get("X-Slack-Signature") ?? "",
  });
}

function parseSharePayload(value: string): SharePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.i !== "string") return null;
  if (typeof obj.r !== "number" || !Number.isFinite(obj.r)) return null;
  return { i: obj.i, r: obj.r };
}

async function postToResponseUrl(
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
  // Best-effort. Slack response_url errors are not retryable from our side.
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
