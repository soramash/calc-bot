/**
 * Slack request signing 検証ユーティリティ。
 * 仕様: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * - basestring = `v0:{timestamp}:{rawBody}`
 * - signature = `v0=` + hex(HMAC-SHA256(signingSecret, basestring))
 * - timestamp は Unix epoch seconds、現在時刻 ± toleranceSeconds (default 300) 以内のみ許容（リプレイ防止）
 * - 比較は constant-time（タイミング攻撃対策）
 *
 * Web Crypto API を使うため Cloudflare Workers / Node 20+ / モダンブラウザ全てで動作する。
 */

const enc = new TextEncoder();

export interface VerifySlackSignatureOptions {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  /** Override for testing. Returns current epoch seconds. */
  now?: () => number;
  /** Allowed clock skew in seconds. Default 300 (5 minutes). */
  toleranceSeconds?: number;
}

export async function verifySlackSignature(
  opts: VerifySlackSignatureOptions,
): Promise<boolean> {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const tolerance = opts.toleranceSeconds ?? 300;

  const ts = Number.parseInt(opts.timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now() - ts) > tolerance) return false;

  if (!opts.signature.startsWith("v0=")) return false;

  const expected = await computeSlackSignature({
    signingSecret: opts.signingSecret,
    timestamp: opts.timestamp,
    rawBody: opts.rawBody,
  });

  return timingSafeEqual(expected, opts.signature);
}

export async function computeSlackSignature(opts: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
}): Promise<string> {
  const basestring = `v0:${opts.timestamp}:${opts.rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(opts.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(basestring));
  return `v0=${toHex(new Uint8Array(sig))}`;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
