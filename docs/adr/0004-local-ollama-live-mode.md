# ADR 0004: Live AI through the visitor's local Ollama

- **Status:** Accepted (2026-09-25); amended by [ADR 0005](0005-cloud-live-mode.md) (2026-09-26): visitors without a
  reachable Ollama now get cloud live mode before sample mode. The Pages browser check is pending the first deploy (see below).
- **Deciders:** owner; build plan §1, §4.2, §9

## Context

The Play-Caller and Chat need a model at interaction time. The site is static (ADR 0001), and a hosted
LLM for anonymous visitors would need a key-holding server and an open-ended bill. The owner has an
M2 Mac (8 GB) that runs Ollama well enough for a 4B instruct model.

## Decision

- The browser calls **Ollama directly** at `http://localhost:11434` (configurable in the AI settings
  popover). On load and on retry it probes `/api/tags` with a 1.5 s timeout, and it keeps
  `live | sample | error` in an `AIStatus` context.
- **Live** is used when the configured model is installed (`qwen3:4b-instruct`, `[ai.live]`).
  **Sample** is used when Ollama is unreachable: every other visitor sees pre-generated sample calls
  (`reports/samples/playcaller.json`) with a banner, and read-only chat. **Error** is used when Ollama
  answers but the model is missing or broken, with an actionable hint.
- Ollama must allow the site's origins with
  `OLLAMA_ORIGINS=https://huntermlady.github.io,http://localhost:4173,http://localhost:5173`.
- If the probe fails with a network error **on an HTTPS page calling http://…**, the UI shows a hint
  that the browser may be blocking it and to use `make preview` for live mode.
- Weekly reports use the same provider interface with the `[ai.batch]` model, now `qwen3:4b-instruct`
  (CONTRACT_CHANGES #21). They run in GitHub Actions since [ADR 0006](0006-reports-in-actions.md); the
  launchd job on the Mac is optional.
  Any stage can be switched to Claude in `config.toml` if it fails the eval bar. In the browser, Claude
  is available only through the dev server proxy.

## Consequences

- Live AI costs nothing and involves no keys. For everyone except the owner it doesn't exist: they
  see samples, which the UI states plainly.
- **Mixed content and local network access:** an HTTPS page (Pages) calling `http://localhost` can
  be blocked by Chrome's Local Network Access permission or by Safari's mixed-content rules. The
  guaranteed path is `make preview` (http://localhost:4173). Whether Pages → localhost works per
  browser has to be verified after deploy.
- Latency depends on the owner's hardware. The eval targets are first token < 3 s and total < 20 s.

## Pages verification (fill in after the first deploy)

Follow the steps in the [README checklist](../../README.md#live-ai-from-pages-checklist) and copy the
results here.

| Date | Browser + version | Local: pill on Pages | Prompt shown? | Local call works? | Local chat works? | Console errors | Blocked-hint shown when blocked? | Cloud: Live · Cloud + call works? | `make preview` live? |
|---|---|---|---|---|---|---|---|---|---|
| | Chrome | | | | | | | | |
| | Safari | | | | | | | | |

**Outcome:** _pending. Record whether live mode from Pages is supported in each browser, or whether
`make preview` is the documented path._
