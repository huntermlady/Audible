# audible-ai (Cloudflare Worker)

Live AI for every visitor. The Worker exposes a small **Ollama-compatible** API on top of
[Workers AI](https://developers.cloudflare.com/workers-ai/), so the web app's existing Ollama
adapter talks to it unchanged (`docs/CONTRACT_CHANGES.md` items 18–20). The owner's Mac still uses
local Ollama. In the browser, `mode: auto` tries local Ollama first, then this Worker, then sample
mode.

## API (item 19)

| Route | Behavior |
|---|---|
| `GET /api/tags` | `{"models":[{"name":"qwen3-30b-a3b",…},…]}`. The default model comes first. |
| `POST /api/chat` | Body is `{model?, messages, stream?, format?, options?:{temperature?}, think?}`. It answers in the Ollama shape: one JSON object, or `application/x-ndjson` when streaming. Streaming is the default, as in Ollama. |
| `OPTIONS *` | CORS preflight. |

Errors come back as `{"error":"<code>","message":"…"}`:

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | Invalid JSON or an invalid body shape |
| 403 | `origin_not_allowed` | An `Origin` header that isn't in `ALLOWED_ORIGINS` |
| 413 | `too_large` | Body over 64 KB, or more than 16 messages |
| 429 | `rate_limited` | More than 10 chats/min from one IP. Sent with `Retry-After: 60` |
| 502 | `upstream_error` | Any other Workers AI failure (capacity, JSON mode not met) |
| 503 | `quota_exhausted` | The daily free Workers AI allocation is used up (error 3036) |

Translation details:
- `format` (a JSON Schema) becomes `response_format: {type:"json_schema", json_schema}`, and
  `format:"json"` becomes `{type:"json_object"}`.
- **Workers AI JSON mode does not stream**, so structured requests with `stream:true` run
  non-streamed. The answer is then sent as two NDJSON lines: the content, then `done`. As a result,
  first-token time equals total time for Play-Caller calls. Free-text chat streams token by token.
- The Workers AI SSE stream becomes Ollama NDJSON. The Worker accepts both the OpenAI
  `choices[].delta.content` shape and the legacy `{response}` shape, and maps `usage` to
  `prompt_eval_count`/`eval_count` on the final `done` line.
- For Qwen3 models, `think` is honored with Qwen's `/no_think` soft switch, added unless
  `think:true`. A leading `<think>…</think>` block is stripped, and `reasoning_content` deltas are
  dropped.
- `max_tokens` is always 1500. A request's `model` is used only if it is listed in `ALLOWED_MODELS`
  (by alias or `@cf/` id). Otherwise `MODEL` is used.
- Requests without an `Origin` header (curl, the Python eval) get no CORS headers. They still count
  against the rate limit.

## Model choice (checked 2026-09-26)

**Default: `@cf/qwen/qwen3-30b-a3b-fp8`** (alias `qwen3-30b-a3b`).

- It is a mixture-of-experts model with about 3B active parameters, so it runs at 8B-class cost
  and speed with 30B-class quality. It has a 32,768-token context window.
- Its `@cloudflare/workers-types` input type declares JSON mode
  (`response_format.type: "json_object" | "json_schema"`) and OpenAI-style output with
  `reasoning_content` kept separate.
- The same Qwen3 family is what the Mac runs through Ollama, so prompt behavior carries over.

Other candidates:
- `@cf/meta/llama-3.1-8b-instruct-fp8` is allowlisted as the fallback alias `llama-3.1-8b`. Its
  types only declare the generic `response_format`, not typed JSON mode, and it costs about twice as
  much per call.
- `@cf/meta/llama-4-scout-17b-16e-instruct` and `@cf/meta/llama-3.3-70b-instruct-fp8-fast` have
  typed JSON mode. The 70B uses about 8× the neurons.
- Cloudflare's JSON-mode docs page still lists `@cf/meta/llama-3.1-8b-instruct`, but that model page
  now returns 404.

## Free allocation and budget

- Workers AI includes **10,000 neurons/day** on both Free and Paid plans. It resets at **00:00 UTC**.
  Past that, the Free plan fails with error `3036` ("Account limited"), which this Worker maps to
  `503 quota_exhausted`. The browser then shows sample mode with "Today's free live-AI allowance is
  used up".
- `qwen3-30b-a3b-fp8` is priced at $0.0509 per M input tokens and $0.335 per M output tokens. At
  $0.011 per 1,000 neurons, that is about 4,630 neurons per M input and about 30,450 per M output.
- A Play-Caller call is about 1.3k prompt tokens, plus the schema JSON mode may inject (about 2.1k
  input in total), and about 450 output tokens. That is **about 23 neurons**, so **about 430 calls
  per day**, or about 215 if every call needs its one retry. A chat turn costs about 15–20 neurons.
- For comparison, `llama-3.1-8b-instruct-fp8` costs about 45 neurons per call.

These figures are estimates from the published prices. Check the real usage in the Cloudflare
dashboard after the first `wrangler dev --remote` session.

## Develop, test, deploy

```bash
cd worker && npm install
npm test                  # vitest in workerd (@cloudflare/vitest-pool-workers); AI is mocked
npm run typecheck
npx wrangler login        # once, by the owner (opens a browser)
npm run dev:remote        # wrangler dev --remote: real Workers AI + rate limiter, local URL
npm run deploy            # wrangler deploy → https://audible-ai.<subdomain>.workers.dev
```

For `make` (owned by T0):
- `make worker-dev` runs `npm --prefix worker run dev:remote`
- `make worker-deploy` runs `npm --prefix worker run deploy`
- `make worker-test` runs `npm --prefix worker test -- --run`

`npm run dev` (local mode, without `--remote`) cannot run the AI binding without a Cloudflare login,
so use `dev:remote` for smoke tests.

After deploying, set the Worker URL as `VITE_AI_CLOUD_URL`: in `web/.env.local` for local builds, and
as a GitHub Actions repository variable for the Pages deploy. It is a public value, not a secret.

Configuration lives in `wrangler.jsonc` under `vars`: `MODEL`, `ALLOWED_MODELS` and
`ALLOWED_ORIGINS`. The rate-limit binding is `RATE_LIMITER` (10 requests per 60 s, keyed by
`CF-Connecting-IP`).
