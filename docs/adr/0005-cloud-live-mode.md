# ADR 0005: Cloud live mode for visitors (Cloudflare Workers AI)

- **Status:** Accepted (2026-09-26, owner-approved Phase 2). Amends ADR 0001 and ADR 0004.
- **Deciders:** owner; CONTRACT_CHANGES #18–20

## Context

With ADR 0004, live AI (Play-Caller, Chat) works only on the owner's machine, and only reliably
through `make preview`, because browsers may block an HTTPS page from calling `http://localhost`.
Every other visitor sees sample calls. For a portfolio demo, the most interesting feature was
therefore invisible to the people it's meant for.

Options considered:

- **Expose the owner's Ollama** through a tunnel such as Cloudflare Tunnel or ngrok. This puts the
  Mac on the public internet, the Mac has to be on, and one 8 GB machine serves every visitor. Rejected.
- **A hosted LLM API (Claude/OpenAI) behind a proxy.** This needs a key-holding server and has an
  open-ended bill if the demo is found or abused. It stays available as an adapter, but it isn't
  the default path.
- **Cloudflare Workers AI behind a small Worker.** The free plan includes a daily Workers AI
  allocation. Workers AI hosts open models from the same families we use locally. The binding needs no
  API key, and the Worker can present exactly the Ollama API the browser already speaks.

## Decision

Add `worker/`, a Cloudflare Worker named `audible-ai`, that implements an **Ollama-compatible
subset** (`GET /api/tags`, `POST /api/chat` with NDJSON streaming and `format` = JSON Schema) on
Workers AI. The browser reuses its Ollama provider with a different base URL (`VITE_AI_CLOUD_URL`,
a public build-time value from the repo variable `AI_CLOUD_URL`).

- **Resolution order** (mode `auto`): local Ollama (1.5 s) → cloud Worker (3 s) → sample. The pill
  shows `Live · Local`, `Live · Cloud`, or sample. Users can pin `local`, `cloud`, or `off`.
- **Abuse controls in the Worker:**
  - A CORS allowlist of the Pages origin plus the local preview and dev origins.
  - A body of at most 64 KB, at most 16 messages, and at most 1,500 output tokens.
  - A model allowlist.
  - A per-IP rate limit of about 10 requests per minute, using the Workers Rate Limiting binding.
- **Quota handling:** a `429` or `503 quota_exhausted` moves the app to sample mode with an
  explanation, never an error state.
- **Unchanged:** grounding (ADR 0002) runs in the browser exactly as before, on the Worker's output.
  The Worker is a dumb, stateless pass-through: no storage, no logs of prompts, no secrets.
- **Unchanged:** Ollama on the owner's Mac still generates the weekly reports and samples, and it
  still serves local live mode.

## Consequences

- Every visitor gets live Play-Caller and Chat, up to the free daily allocation, at no cost and with
  no exposure of the owner's machine.
- This **relaxes the "no hosted server of any kind" non-goal** (BUILD_PLAN §1, ADR 0001). A Worker is
  now part of the system. It is stateless, and it's free as long as it stays within the Cloudflare free
  plan. It is also optional: without `AI_CLOUD_URL` the site degrades to exactly the ADR 0004 behavior.
- **Quota is shared and finite.** On a busy day, later visitors get sample mode until the daily reset.
  The per-IP limit stops one visitor from using it all, but a distributed abuser could. The worst
  case is sample mode for the rest of the day, never a bill.
- **Model parity:** Workers AI's catalog isn't identical to Ollama's tags. The cloud default is
  `@cf/qwen/qwen3-30b-a3b-fp8` (same Qwen3 family, MoE with about 3B active parameters), not the local
  `qwen3:4b-instruct`. Workers AI JSON mode doesn't stream, so a structured cloud call's first token
  arrives with the whole answer. Because cloud calls use a different model than local ones, so the eval (`make eval`) should cover the cloud model as well.
  Grounding keeps the output honest either way.
- There's a second deploy target to maintain (`wrangler deploy`), plus one more account (Cloudflare).
- CORS limits which browser origins can call the Worker, not which clients can. Non-browser clients can
  still call it, and only the rate limit and quota contain them.
- The e2e suite stubs the Worker (`web/e2e/cloud-live.spec.ts`), so CI never spends quota.
