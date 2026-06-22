# calc-bot

A Slack `/calc` slash command bot with exponent (`^`) support. Runs on Cloudflare Workers and replies to `/calc` with the evaluated arithmetic — including parentheses, decimals, and exponents — as an ephemeral message.

> 日本語版は [README.ja.md](./README.ja.md) を参照してください。

## Prerequisites

- Node.js 20 or later (24.x recommended; a version manager such as `mise` works fine)
- npm 10 or later
- A [Cloudflare account](https://dash.cloudflare.com/)
- Admin rights on a Slack workspace (to install the app)

## Setup

```sh
npm install
```

## Local development

```sh
# Run all tests (calc_logic / calc_format / slack_signature / index)
npm test

# Type-check
npm run typecheck

# Start the Worker locally on http://localhost:8787
npm run dev
```

`npm run dev` only binds to localhost, so Slack cannot reach it directly. To exercise the Slack integration locally, either deploy to Workers (see below) and point Slack at the deployed URL, or expose your local server with [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-tunnel/) or ngrok.

## Deploy to Cloudflare Workers

```sh
# First time only: log in to Cloudflare
npx wrangler login

# Deploy. The output prints the Workers URL (https://calc-bot.<subdomain>.workers.dev).
npm run deploy
```

The Slack endpoint is the deployed URL plus `/slack/calc`, for example:

```
https://calc-bot.<your-subdomain>.workers.dev/slack/calc
```

## Slack app configuration

1. Open <https://api.slack.com/apps> and choose **Create New App** → **From a manifest**.
2. Select the target workspace and paste the contents of `slack-app-manifest.yaml`.
3. Replace `slash_commands[0].url` with the deployed Workers URL (ending in `/slack/calc`), then create the app.
4. From the app page, click **Install App** to install it into the workspace.
5. Open **Basic Information → Signing Secret** and click *Show* to copy the value.
6. Register the value as a Worker secret:

   ```sh
   npx wrangler secret put SLACK_SIGNING_SECRET
   # Paste the Signing Secret when prompted
   ```

7. From any channel in the workspace, run `/calc 100 + 200`. You should see an ephemeral reply such as `🧮 *Calculation Result* … Answer: *300*`.

> If something goes wrong, `npx wrangler tail` streams real-time logs. A 401 response usually means the Signing Secret is missing or the request URL path is not `/slack/calc`.

## Test cases

`npm test` exercises the full set below (25 cases in total).

### Calculation core (PLAN spec)

| No | Input | Expected |
|----|-------|----------|
| 1 | `100 + 200 * 3 - 50` | `650` |
| 2 | `(100 + 200) * 3` | `900` |
| 3 | `10 / 4` | `2.5` |
| 4 | `1,500 + 500` | `2000` |
| 5 | `2 ^ 3` | `8` |
| 6 | `10 + 2 ^ 3 * 5` | `50` |
| 7 | `10 / 0` | error (`div_by_zero`) |
| 8 | `10 + abc / window.alert()` | error (`illegal_char`) |

### Additional cases

| No | Input | Expected |
|----|-------|----------|
| 9 | `-2 ^ 3` | `-8` |
| 10 | `9 ^ 9 ^ 9` | error (`exponent_overflow`) |
| 11 | `2 ^ 60` | error (`result_overflow`) |
| 12 | `(1+2)*((3+4))` | `21` |

The suite also covers four Slack signature verification cases and five fetch-handler cases (success, error response, invalid signature → 401, GET → 404, other path → 404).

## Limitations & roadmap

### Cloudflare Workers free tier

- Requests: **100,000 / day, shared across the entire account**
- CPU time: 10 ms / request (calc-bot measures 2-5 ms in practice)
- Bundle size: 3 MB (calc-bot is around 50 KB)

See the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) page for the full list.

### Security

- Expression evaluation goes through the `expr-eval` AST (no `eval()`).
- Multiple guards: character whitelist, unknown-symbol detection, literal-exponent absolute-value cap (≤ 100), and result range cap (`Number.MAX_SAFE_INTEGER`).
- Slack request verification uses HMAC-SHA256 with a 5-minute timestamp tolerance and constant-time comparison.

### Roadmap (Phase 2)

- A "share to channel" Block Kit button (currently ephemeral only; see Decision Q4 D in `PLAN.md`).
- BigInt support and thousands-separator output formatting (currently any value beyond `Number.MAX_SAFE_INTEGER` is rejected).

## Project layout

```
.
├── package.json                # npm scripts and dependencies
├── wrangler.jsonc              # Cloudflare Workers config
├── tsconfig.json               # TypeScript config
├── vitest.config.ts            # Test config
├── slack-app-manifest.yaml     # Slack app manifest (paste into Slack)
├── src/
│   ├── index.ts                # Workers fetch handler (Slack inbound → calc → ephemeral reply)
│   ├── index.test.ts           # Handler integration tests
│   ├── slack_signature.ts      # HMAC-SHA256 signature verification (Web Crypto API)
│   ├── slack_signature.test.ts
│   ├── calc_logic.ts           # Expression evaluation core (expr-eval AST + guards)
│   ├── calc_logic.test.ts
│   ├── calc_format.ts          # Slack message formatter
│   └── calc_format.test.ts
├── PLAN.md                     # Design notes and decision log (in Japanese)
├── README.md                   # This file
└── README.ja.md                # Japanese version of this README
```
