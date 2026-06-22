import { evaluate } from "./calc_logic";
import { formatResult } from "./calc_format";
import { verifySlackSignature } from "./slack_signature";

export interface Env {
  SLACK_SIGNING_SECRET: string;
}

const SLASH_COMMAND_PATH = "/slack/calc";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== SLASH_COMMAND_PATH) {
      return new Response("Not Found", { status: 404 });
    }

    const timestamp = request.headers.get("X-Slack-Request-Timestamp") ?? "";
    const signature = request.headers.get("X-Slack-Signature") ?? "";
    const rawBody = await request.text();

    const valid = await verifySlackSignature({
      signingSecret: env.SLACK_SIGNING_SECRET,
      timestamp,
      rawBody,
      signature,
    });
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    const text = new URLSearchParams(rawBody).get("text") ?? "";
    const result = evaluate(text);
    const message = formatResult(text, result);

    return Response.json({
      response_type: "ephemeral",
      text: message,
    });
  },
};
