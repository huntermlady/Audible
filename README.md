# Audible

NFL team, matchup, and player analytics, with an **AI Offensive Coordinator** and an **AI Defensive
Coordinator** built on top.

Live site: **https://huntermlady.github.io/Audible/**

- **Dashboard**: this week's slate, the best and worst units by EPA per play, and a league map.
- **Team**: KPIs with ranks, weekly trends, pass rate over expected (PROE), down-and-distance tendency heatmaps, and field-zone tendencies.
- **Matchup**: unit-vs-unit comparisons and four pre-generated game-plan reports (each team's OC and DC).
- **Play-Caller**: set a situation (down, distance, spot, clock, score) and get a call from the OC or DC.
- **Players**: position leaderboards with season splits.
- **Chat**: ask the coordinators about the page you're on.

The coordinators are **grounded**. The app builds a *fact sheet* of stat IDs from the data. The model
must answer in schema-valid JSON that cites those IDs, and every number on screen is rendered from
the fact sheet. Nothing is taken from the model's prose. A validator rejects any output that
contains an ungrounded number.

## Architecture

```
nflverse ──► pipeline/ (Python, nightly GitHub Action) ──► data/*.parquet + manifest.json ─┐
                                                                                            ├─► GitHub Pages (static)
weekly-reports.yml (Actions) ── ai/ + Ollama (CPU) ──► reports/*.json (committed) ─────────┘
                                                                                            │
browser ── React + DuckDB-WASM queries the Parquet in the page ◄────────────────────────────┘
        └─ Live AI (auto): 1. local Ollama at http://localhost:11434 (owner's machine)
                           2. Cloudflare Worker `audible-ai` → Workers AI (everyone else; free daily quota)
                           3. sample mode (pre-generated calls)
```

- **Static first.** The site is HTML, JS, Parquet, and JSON on GitHub Pages ([ADR 0001](docs/adr/0001-static-first.md)). The only server-side piece is a small, stateless Cloudflare Worker that gives visitors live AI ([ADR 0005](docs/adr/0005-cloud-live-mode.md)).
- **Data:** the current season plus the prior 5, from [nflverse](https://github.com/nflverse) via `nflreadpy`, shipped only as precomputed aggregates. The browser queries them with DuckDB-WASM, and each page fetches only the Parquet files it needs ([ADR 0003](docs/adr/0003-duckdb-wasm.md)).
- **AI:** Game-plan reports are generated weekly by a GitHub Action that runs Ollama on the runner, and committed ([ADR 0006](docs/adr/0006-reports-in-actions.md)). Play-Caller and Chat call a local Ollama from the browser when one is reachable ([ADR 0004](docs/adr/0004-local-ollama-live-mode.md)). Otherwise they call the Cloudflare Worker, which serves the same Ollama-compatible API from Workers AI ([ADR 0005](docs/adr/0005-cloud-live-mode.md)). Grounding is described in [ADR 0002](docs/adr/0002-fact-sheet-grounding.md).
- **Contracts:** JSON Schemas in `shared/schemas` generate both the pydantic models and the TS types. The fact-sheet spec and its golden fixtures in `shared/factsheet` are run by both the Python and TS test suites.

More detail: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) (plan), [`docs/CONTEXT.md`](docs/CONTEXT.md) (glossary), [`docs/CONTRACTS.md`](docs/CONTRACTS.md) (data and AI contracts).

## Prerequisites

| Tool | Version | Install (macOS) |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.5 (it installs Python 3.12 itself) | `brew install uv` |
| Node.js | 22 | `brew install node@22` (or nvm / fnm) |
| GNU make, git | any | Xcode Command Line Tools |
| [Ollama](https://ollama.com) | optional; needed for live AI and `make reports` | `brew install ollama` or the macOS app |
| `gh` (GitHub CLI) | optional; to dispatch workflows and download nightly data | `brew install gh` |
| Cloudflare account | optional; free plan, only to deploy the visitor live-AI Worker | [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) |

The Python venv lives at `~/.venvs/audible` (outside iCloud-synced folders) and is symlinked to `.venv`.

## Quick start (fresh clone)

```bash
git clone https://github.com/huntermlady/Audible.git && cd Audible
make setup      # uv sync + npm ci in web/ and worker/ (+ pre-commit hooks if configured)
make data       # download nflverse and build data/ (current season + prior 5; the first run takes several minutes)
make build      # production build of web/ into web/dist, with data/ and reports/ copied in
make preview    # serve it at http://localhost:4173/Audible/
```

Open **http://localhost:4173/Audible/**. `make preview` is the closest thing to GitHub Pages, and it is
the most reliable way to use local live AI (see below). For development with hot reload, run `make web`
(http://localhost:5173/Audible/).

### Mock-data mode (no pipeline, no network)

```bash
make mock-data   # writes data/ from shared/fixtures (all 32 teams, 2 seasons, 2026 week 4 upcoming)
```

`make mock-data` also seeds `reports/` with the mock week-4 KC–BAL game plans, but only when
`reports/index.json` doesn't already exist. **Don't commit these mock reports.** The deploy workflow
fails if `reports/` holds a fixture copy or a report whose `model` is `fixture-mock` or whose
`provider` is `fake`. To go back to real data, run `make data` and restore `reports/` from git
(`git checkout -- reports && git clean -fd reports`).

## Make targets

| Target | Does |
|---|---|
| `make setup` | `uv sync` (venv at `~/.venvs/audible`, symlinked to `.venv`), `npm ci` in `web/` and `worker/`, pre-commit hooks |
| `make types` | Regenerate the pydantic and TS types from `shared/schemas` |
| `make check-types` | Regenerate into a temp dir and diff; fails if the committed types are stale |
| `make data` | Run the pipeline → `data/` (`SEASONS=auto` = current-5..current; e.g. `make data SEASONS=2024-2026`) |
| `make mock-data` | Write mock `data/` from `shared/fixtures` (and seed `reports/` if it's empty) |
| `make reports` | Weekly batch job, run locally: game-plan reports for `WEEK=auto` (needs Ollama and the `[ai.batch]` model). The default is the `weekly-reports` GitHub Action |
| `make eval` | Run the 12 eval scenarios and print a scorecard |
| `make web` | Vite dev server, serving `data/` and `reports/` at `/Audible/data` and `/Audible/reports` |
| `make build` | Production build → `web/dist` (copies `data/` and `reports/`, writes `404.html` for deep links) |
| `make preview` | Serve `web/dist` at http://localhost:4173/Audible/ |
| `make test` | pytest + Vitest (web and Worker) |
| `make e2e` | Playwright against `make preview` (see [Testing](#testing)) |
| `make lint` | ruff, pyright, eslint, `tsc --noEmit` (web and Worker) |
| `make worker-dev` | `wrangler dev --remote`: the cloud AI Worker on a local URL, using real Workers AI (needs `npx wrangler login`) |
| `make worker-deploy` | `wrangler deploy` the Worker to `audible-ai.<subdomain>.workers.dev` |
| `make worker-test` | Worker unit tests (Workers AI mocked) |

## Live AI: how the app picks a model

The AI status pill in the top bar shows where live AI comes from. Its popover sets the **mode**, the
Ollama base URL, and the model. These are stored in `localStorage`.

| Mode | Behavior |
|---|---|
| **Auto** (default) | Probe local Ollama (`/api/tags`, 1.5 s timeout), then the cloud Worker at `VITE_AI_CLOUD_URL` (3 s), then fall back to sample mode |
| **Local** | Only local Ollama |
| **Cloud** | Only the cloud Worker |
| **Off** | Never call a model; show sample calls |

| Pill | When | What you get |
|---|---|---|
| **Live · Local** | Ollama answers and the configured model is installed | Play-Caller calls for any situation; chat |
| **Live · Cloud** | Ollama is unreachable and the Worker answers | The same features, served by Workers AI, within the free daily quota |
| **Sample** | Neither is reachable, or the cloud quota or rate limit was hit | Pre-generated sample calls from `reports/samples/playcaller.json` with a "this is a sample call" banner; chat is read-only with an explanation. There are no errors or spinners. |
| **Error** | Ollama answers, but the model is missing or the response is bad | The pill explains the problem (for example, ``Run `ollama pull qwen3:4b-instruct` ``) |

Game-plan reports on matchup pages are pre-generated, so every visitor sees them in every mode.

## Ollama (the owner's Mac: local live mode, optional local reports)

```bash
brew install ollama
brew services start ollama                      # runs `ollama serve` at login (launchd); or install the macOS app instead
ollama pull qwen3:4b-instruct                   # live model ([ai.live] in config.toml) and batch model ([ai.batch])
```

The browser calls Ollama directly, so Ollama must allow the site's origins (CORS):

```
OLLAMA_ORIGINS=https://huntermlady.github.io,http://localhost:4173,http://localhost:5173
```

Set it for whichever way you run Ollama. Neither launchd nor the macOS app reads your shell profile.

- **`brew services`, or the macOS app:** set it in the launchd user environment, then restart Ollama:
  ```bash
  launchctl setenv OLLAMA_ORIGINS "https://huntermlady.github.io,http://localhost:4173,http://localhost:5173"
  brew services restart ollama        # or quit and reopen the Ollama app
  ```
  `launchctl setenv` doesn't survive a reboot. To make it permanent, run that line from a login item
  or a small LaunchAgent, before Ollama starts.
- **`ollama serve` in a terminal:** `export OLLAMA_ORIGINS=…` in that shell (or in `~/.zshrc`) first.

Check it: `curl -s http://localhost:11434/api/tags` lists your models, and
`curl -si -H "Origin: http://localhost:4173" http://localhost:11434/api/tags | grep -i access-control-allow-origin`
echoes the origin back.

### Local Ollama from the deployed (HTTPS) site

The deployed site is HTTPS and Ollama is `http://localhost`. Browsers may block that request:
Chrome's **Local Network Access** permission (a prompt, or a block, for public sites that call
localhost), or Safari's **mixed-content** rules. In Auto mode a blocked local probe just falls through
to the cloud Worker. To force local, choose **Local** in the pill. If the browser blocks it, the UI
shows this hint: *"the browser may be blocking this HTTPS page from reaching it over
http://localhost. Use `make preview` for live mode."* **`make preview` (http://localhost:4173) always
works for local live mode**, because it's plain HTTP on the same machine. The verified results per
browser are in the [checklist below](#live-ai-from-pages-checklist).

## Live AI for visitors (Cloudflare Worker)

`worker/` is a Cloudflare Worker (`audible-ai`) that answers an **Ollama-compatible subset**
(`GET /api/tags`, `POST /api/chat`, streamed NDJSON, and `format` = JSON Schema) using
**Workers AI**. The browser reuses its Ollama adapter with a different base URL. It holds no
secrets and stores nothing ([ADR 0005](docs/adr/0005-cloud-live-mode.md)).

**Prerequisites:** a free Cloudflare account, and `npx wrangler login` once, which opens the
browser to authorize Wrangler.

```bash
cd worker && npm install
npm test                    # vitest in workerd; Workers AI is mocked
npx wrangler login          # once (opens a browser)
npm run dev:remote          # = make worker-dev; wrangler dev --remote: real Workers AI + rate limiter on a local URL (spends quota)
npm run deploy              # = make worker-deploy; wrangler deploy → https://audible-ai.<your-subdomain>.workers.dev
```

Plain `npm run dev` (local mode) can't use the AI binding, so use `dev:remote` for smoke tests.
Configuration lives in `worker/wrangler.jsonc`: `MODEL` (default `qwen3-30b-a3b` →
`@cf/qwen/qwen3-30b-a3b-fp8`), `ALLOWED_MODELS`, `ALLOWED_ORIGINS`, and the `RATE_LIMITER`
binding. API details, the model choice, and cost estimates are in [`worker/README.md`](worker/README.md).

Then point the site at it:

- **Deploy:** GitHub → **Settings → Secrets and variables → Actions → Variables → New repository
  variable**: `AI_CLOUD_URL` = the `workers.dev` URL. It's a public *variable*, not a secret, because
  it ends up in the JS bundle. `deploy.yml` passes it to the build as `VITE_AI_CLOUD_URL`. Push or
  re-run the deploy to pick it up. When it's unset, the deploy warns and visitors get sample mode.
- **Local:** put `VITE_AI_CLOUD_URL=https://audible-ai.<your-subdomain>.workers.dev` (or
  `http://localhost:8787` for `wrangler dev`) in `web/.env.local`, then `make build && make preview`,
  or run `make web`.

**Limits and quota.** The Worker enforces these on every request:

- **CORS:** only `https://huntermlady.github.io`, `http://localhost:4173`, and `http://localhost:5173` are allowed (`ALLOWED_ORIGINS`). Other origins get `403 origin_not_allowed`.
- **Size:** the body is at most 64 KB and holds at most 16 messages. Output is capped at 1,500 tokens. Violations get `400` or `413`.
- **Rate:** 10 chat requests per minute per IP, using the Workers Rate Limiting binding. Over that, it returns `429 rate_limited` with `Retry-After: 60`.
- **Quota:** Workers AI's free allocation is 10,000 neurons per day, shared by all visitors. That's roughly 400 Play-Caller calls, or about 200 if every call needs its one retry (estimates in `worker/README.md`). When it's used up, the Worker returns `503 quota_exhausted` until the reset at 00:00 UTC.
- **Models:** the Worker ignores the request's `model` unless it's on the Worker's allowlist, and uses its own default otherwise.

On a `429` or `503` the app switches to sample mode with *"Today's free live-AI allowance is used up —
showing sample calls."* Nothing breaks, and live mode comes back after a retry from the pill (or on the
next visit) once the limit resets.

## Optional: Claude in development (dev only)

```bash
cp .env.example .env    # then set ANTHROPIC_API_KEY=… (.env is gitignored)
make web                # dev server only
```

In the AI settings popover, set the model to a `claude-…` ID (for example `claude-sonnet-5`). The
Vite **dev server** proxies `/__claude` to the Anthropic API and adds the key on the server side. The
key never reaches the browser. The proxy and the dev Claude adapter don't exist in `make build` or
`make preview`, and CI fails the deploy if any trace of them is in `web/dist`. For the batch job, set
`[ai.batch] provider = "claude"` in `config.toml`. Spend is capped by `[ai.claude].max_daily_usd`.

## Weekly reports (GitHub Actions)

`.github/workflows/weekly-reports.yml` generates the week's game plans on a GitHub runner, with no
Mac needed ([ADR 0006](docs/adr/0006-reports-in-actions.md)). It runs every **Wednesday at 04:00 UTC**
(Tuesday night, US Eastern):

1. Downloads the newest nightly `data/` artifact. If none exists, it runs `make data`.
2. Installs Ollama, restores the cached model (`actions/cache`, keyed on the `[ai.batch].model` tag in
   `config.toml`) or pulls it, and starts `ollama serve`.
3. Runs `audible_ai reports --week auto --provider ollama --out reports --skip-existing`: 4 reports
   per game (each team's OC and DC), then the Play-Caller samples. CPU only.
4. Always, even after a failure or the 5 h 20 min step timeout: runs the mock/fake-report guard,
   commits `reports/` as `github-actions[bot]` ("reports: week N (auto)") if anything changed,
   pushes to `main`, and dispatches `deploy.yml`. A push made with `GITHUB_TOKEN` doesn't trigger
   other workflows, so the deploy is dispatched explicitly.
5. Writes a timing table to the job summary: count, passed/failed, and average and max seconds per report.

A run that times out keeps everything it finished. Run the workflow again and `--skip-existing`
carries on where it stopped. Run it by hand from **Actions → weekly-reports → Run workflow**, or
with `gh`:

```bash
gh workflow run weekly-reports.yml --ref main                     # this week, all games
gh workflow run weekly-reports.yml --ref main -f week=5           # a specific week
# Smoke run: one game (4 reports, no samples). Measures CPU speed; its reports are real and are committed.
GAME=$(jq -r --slurpfile m data/manifest.json \
  '[.[] | select(.season == $m[0].current_season and .week == $m[0].current_week)][0].game_id' data/schedule.json)
gh workflow run weekly-reports.yml --ref main -f games="$GAME"
gh run watch "$(gh run list --workflow weekly-reports.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

(`GAME` comes from your local `data/`, so run `make data` first, or set it to any current-week
`game_id` such as `2026_05_KC_LV`.)

If `main` is protected, allow `github-actions[bot]` to push, or the commit step fails. Reports are
still generated, but they aren't saved.

**Optional: on the Mac (launchd).** The original local job still works. It runs `make reports`
every Tuesday at 23:00 with the Mac's Ollama, commits, and pushes. Use it only if the Action is too
slow, and don't run both in the same week: they would race to push. Install steps, logs, and git
credential setup are in [`ai/launchd/README.md`](ai/launchd/README.md).

## Testing

```bash
make test                          # pytest + Vitest (web and Worker)
make lint
make mock-data && make build       # e2e runs against the mock week-4 data and reports
make e2e                           # Playwright; starts `npm run preview` itself
BASE_URL=https://huntermlady.github.io/Audible/ npm --prefix web run e2e   # same suite against the deployed site
```

The cloud live-mode spec (`e2e/cloud-live.spec.ts`) stubs the Worker, so it never calls the real one,
but it needs a build that has a cloud URL: `VITE_AI_CLOUD_URL=https://audible-ai.e2e.invalid make build`.
Against a build without one, those tests skip. Set `E2E_REQUIRE_CLOUD=1` to make them fail instead
(CI should do this). Team logos are also stubbed, so no test depends on the ESPN CDN.
If something else already holds port 4173, run the suite on its own preview with `E2E_PORT=4273 make e2e`.

The first Playwright run needs a browser: `(cd web && npx playwright install chromium)`. The suite
(`web/e2e/`) includes:

- **Smoke:** every route × light/dark × 1280 px/375 px. Checks the h1, the absence of console errors, and no horizontal scroll at 375 px.
- **Accessibility:** axe (WCAG 2.1 A/AA) on every route in both themes.
- **Theme:** the no-flash first paint and toggle persistence.
- **Deep links:** the `404.html` fallback.
- **Sample mode:** local Ollama and the cloud Worker are blocked in every test by default.
- **Cloud live mode:** a stub Worker returns a grounded CoordinatorCall. The tests check that the pill shows "Live · Cloud", that the call renders, that chat is enabled, and that a `503 quota_exhausted` falls back to sample mode.
- **Logos:** team logos render with alt text, and the monogram replaces a logo that fails to load.
- **Lazy data:** each page fetches only the Parquet files it uses.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` runs on every push to `main`, and it is dispatched by `nightly-data.yml`
with that run's id. It:

1. Fails if `reports/` contains mock or fake reports.
2. Downloads the `data` artifact (from the dispatching run, otherwise the latest successful nightly run). If none exists, it runs `make data`.
3. Runs `npm ci` and `make build` with `VITE_AI_CLOUD_URL` taken from the repository variable `AI_CLOUD_URL`. Verifies that `dist/` has `404.html`, `data/`, and `reports/`. Runs the no-secrets bundle check. Asserts that the site is under 150 MB.
4. Uploads the Pages artifact and runs `actions/deploy-pages`.

One-time setup:

1. Create the public repo `huntermlady/Audible` and push `main`. `reports/` must contain only real reports, or nothing.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Actions → General → Workflow permissions:** the default read-only token is enough, because each workflow declares its own permissions.
4. Optional, for visitor live AI: deploy the Worker (see [above](#live-ai-for-visitors-cloudflare-worker)) and set the repository **variable** `AI_CLOUD_URL`.
5. Optional: run **Actions → nightly-data → Run workflow** once. It builds `data/` and dispatches the deploy. Otherwise, the first deploy builds `data/` itself.

`nightly-data.yml` runs daily during the season (Sep–Feb) and weekly in the offseason. It validates
`data/` against the schemas, uploads it as the `data` artifact (kept for 14 days), and dispatches the
deploy.

## Live-AI-from-Pages checklist

Run this after the first deploy. It is the BUILD_PLAN §6 Track 5 acceptance item. Record the results
here and in [ADR 0004](docs/adr/0004-local-ollama-live-mode.md).

1. Pull both models. Set `OLLAMA_ORIGINS` as above, including `https://huntermlady.github.io`, and restart Ollama. `curl http://localhost:11434/api/tags` must work.
2. **Chrome, local:** open https://huntermlady.github.io/Audible/play-caller in a normal window. In the AI status pill, set the mode to **Local** so a blocked call can't silently fall through to the cloud.
   - If a "wants to access devices on your local network" / local network access prompt appears, record it, then choose **Allow**.
   - Record the pill (Live · Local / Sample / Error) and any hint text in the sample banner or the pill popover.
   - If it's live: click **Get the OC call** and record whether the call renders. Open chat and ask one question.
   - DevTools → Console: record any `Private Network Access`, `Local Network Access`, CORS, or mixed-content errors.
3. **Safari, local:** same steps. Also check Develop → Show JavaScript Console for mixed-content ("was not allowed to request insecure content") errors.
4. **Cloud:** in each browser, set the mode to **Cloud** (or **Auto** with Ollama quit). The pill must show **Live · Cloud**, a call must render, and chat must answer.
5. **Negative check:** set the mode to **Auto**, quit Ollama, and block the Worker (DevTools → Network → right-click a `workers.dev` request → Block request URL). Reload and confirm sample mode appears with no error toasts and no spinner.
6. **Fallback check:** `make build && make preview` → http://localhost:4173/Audible/play-caller shows **Live · Local** in both browsers.
7. Run the e2e suite against the live URL: `BASE_URL=https://huntermlady.github.io/Audible/ E2E_REQUIRE_CLOUD=1 npm --prefix web run e2e`.

| Date | Browser + version | Local: pill on Pages | Prompt shown? | Local call works? | Local chat works? | Console errors | Blocked-hint shown when blocked? | Cloud: Live · Cloud + call works? | `make preview` live? |
|---|---|---|---|---|---|---|---|---|---|
| _yyyy-mm-dd_ | Chrome _…_ | | | | | | | | |
| _yyyy-mm-dd_ | Safari _…_ | | | | | | | | |

If a browser blocks the local call, that's an accepted outcome, as long as the UI shows the "use
`make preview`" hint in Local mode and Auto mode falls through to the cloud. Record it in the table.

## Repository layout

```
shared/     contracts: JSON Schemas, prompts, fact-sheet spec + golden fixtures, eval scenarios, mock fixtures, teams.json
pipeline/   Python: nflverse → data/ (see pipeline/README.md)
ai/         Python: providers (Ollama, Claude), fact sheets, grounding, weekly reports, eval; optional launchd job
worker/     Cloudflare Worker `audible-ai`: Ollama-compatible /api/tags + /api/chat on Workers AI (visitor live mode)
web/        React + Vite + TS app: src/ (app, design, data, ai, pages, features), tests/ (Vitest), e2e/ (Playwright)
data/       build output (gitignored): Parquet + JSON + manifest.json
reports/    committed AI game-plan reports + index.json + samples/playcaller.json
docs/       BUILD_PLAN, CONTEXT (glossary), CONTRACTS, CONTRACT_CHANGES, adr/
config.toml AI model/provider config (no secrets); secrets go in .env (gitignored)
.github/workflows/  ci.yml (lint, types, tests), nightly-data.yml (data), weekly-reports.yml (AI reports), deploy.yml (Pages)
.github/scripts/    check_reports.py (mock/fake-report guard), report_timing.py (job-summary timing)
```

## Data and attribution

All football data comes from **[nflverse](https://github.com/nflverse)** (play-by-play, schedules,
rosters, FTN charting, and participation data) via
[`nflreadpy`](https://github.com/nflverse/nflreadpy), and is used under nflverse's licenses. FTN
charting data is © FTN Data, licensed CC-BY-SA 4.0 via nflverse. The site ships only aggregates.
Audible isn't affiliated with the NFL or any team.
