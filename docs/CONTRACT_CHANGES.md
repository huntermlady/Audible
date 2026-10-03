# Contract changes

Append-only log of changes to `shared/` or `docs/CONTRACTS.md` after M0.

## 2026-09-25 — pre-M0 clarifications (lead-approved, from t1 nflreadpy findings)
1. **Team abbreviations** = nflverse pbp abbreviations for all seasons (Rams = `LA`). `shared/teams.json` and fixtures use these.
2. **Bucket perspective:** every bucket (down, dist_bucket, field_zone, score_state, time_bucket) is from the **offense's** perspective, including `side=def` rows (e.g. def cell `trail_1_8-two_minute` = the offense faced was trailing 1–8).
3. **Nullability:** in `team_tendencies`, every rate/EPA metric except `plays` and `low_sample` is nullable (null when its denominator is 0, never 0). The same rule applies to `team_week` and `team_season` rate/EPA columns. Ranks are null when the metric is null.
4. **Season scope:** `team_season`, `team_tendencies`, and `player_season` = REG season only. `team_week` includes postseason (weeks 19–22). Plays require `down` not null (2-pt tries excluded). Only final games are included.
5. **Optional-data coverage (real data):** blitz 2021–2026 (FTN 2022+, participation 2021); play_action/screen 2022+; man/zone/pressure 2021–2025 (2026 null until nflverse publishes participation).
## 2026-09-25 — pre-M0 (lead-approved, from t2)
6. **FactSheetContext** gains a third kind: `{"kind":"team","season":int,"team":str}` (team's off + def blocks, no opponent). Used by chat on team pages.
7. **Grounding** additionally accepts: any fact `n`, `100 - yardline_100` (e.g. "own 35"), and the season year. Specified in `shared/factsheet/SPEC.md`.
8. **config.toml:** `[ai.live] model = "qwen3:4b-instruct"`; `[ai.batch] model = "qwen3:8b"`. Optional keys: `[ai.live].think`, `[ai.batch].think` (bool, default false), `[ai.batch].fallback_model`.
9. **`/__claude` dev proxy** spec lives in `docs/HANDOFFS.md` (t2 → t3).
## 2026-09-25 — pre-M0 (lead-approved, from t0)
10. `CoordinatorCall.primary.play_family` nullable (null for DC calls); DC fields `front`/`coverage_shell`/`pressure` null for OC calls.
11. `Scenario` adds nullable `acceptable_pressures`, `unacceptable_pressures`, `acceptable_coverage_shells`; OC lists null on DC scenarios and vice versa.
12. `FactSheet.derived` nullable (null for `matchup` and `team` contexts).
13. Python: `FactSheetContext` is a union alias → validate with pydantic `TypeAdapter`. Models importable from `audible_contracts.models`; paths from `audible_contracts.paths`.
14. `GamePlanReport.provider` (and `PlaycallerSample` provider/model fields, if any) enum adds `"fake"` — deterministic test-only provider; fake runs write to a scratch dir unless `--out` is given, never to `reports/` by default.
15. `shared/fixtures/data/team_tendencies` is committed gzipped (`team_tendencies.json.gz`); read via `audible_contracts.fixtures.load_rows` (Py) or zlib gunzip (Node).
16. `Scenario` adds nullable `acceptable_fronts` (DC scoring); OC scenarios null.

## 2026-09-26 — Phase 2: logos + live AI for everyone (owner-approved)
17. **Team logos.** `Team` gains required nullable `logo_url` and `wordmark_url` (strings, https). Values come from nflverse's teams dataset (`nflreadpy.load_teams()` → `team_logo_espn`, `team_wordmark`), hotlinked, never committed as files. UI renders `<TeamLogo>` with the monogram as fallback on error/null.
18. **AI engines.** Ollama (owner's Mac) = weekly batch reports + samples, and live mode when the browser can reach `localhost:11434`. **Cloudflare Worker + Workers AI** (`worker/`, name `audible-ai`) = live mode for everyone else. No Claude in the default path (Claude adapter stays, unused).
19. **Worker API = Ollama-compatible subset**, so the existing TS Ollama adapter is reused with a different base URL:
    - `GET /api/tags` → `{"models":[{"name":"<model alias>"}]}`
    - `POST /api/chat` body `{model?, messages:[{role,content}], stream:bool, format?: <JSON Schema object>, options?:{temperature?}, think?}`
      - non-stream → `{"model":"…","message":{"role":"assistant","content":"…"},"done":true,"prompt_eval_count":n|null,"eval_count":n|null}`
      - stream → `application/x-ndjson` lines `{"model":"…","message":{"role":"assistant","content":"<chunk>"},"done":false}` … final `{"done":true,…}`
    - `model` in the request is ignored unless it is in the Worker's allowlist; default = `env.MODEL`.
    - Errors (JSON `{"error":"<code>","message":"…"}`): 400 `bad_request`, 403 `origin_not_allowed`, 413 `too_large`, 429 `rate_limited` (+`Retry-After`), 503 `quota_exhausted` (Workers AI daily free allocation used up), 502 `upstream_error`.
    - CORS: only origins in `env.ALLOWED_ORIGINS` (`https://huntermlady.github.io,http://localhost:5173,http://localhost:4173`); `OPTIONS` preflight supported.
    - Limits: body ≤ 64 KB, ≤ 16 messages, max output tokens ≤ 1500, per-IP rate limit (Workers Rate Limiting binding, ~10 req/min).
20. **Browser AI status resolution:** settings `mode: 'auto'|'local'|'cloud'|'off'` (default auto). Auto = probe local Ollama (1.5 s) → probe `VITE_AI_CLOUD_URL` `/api/tags` (3 s) → sample. `useAIStatus()` adds `source: 'local'|'cloud'|null`; `Provider.name` union adds `'cloud'`. On a cloud 429/503 during use, status becomes `sample` with `errorHint` ("Today's free live-AI allowance is used up — showing sample calls."). `VITE_AI_CLOUD_URL` is a public build-time value (not a secret); set in `web/.env.local` locally and as a GitHub Actions repo variable for deploy.
## 2026-09-27 — owner decision (relayed by lead, applied by t0)
21. **Batch model:** `[ai.batch] model = "qwen3:4b-instruct"` and `fallback_model = "qwen3:4b-instruct"`. The batch job uses qwen3:4b-instruct because of the 8 GB RAM / disk limits (only that model is installed locally); revisit in M4. `[ai.live]` is unchanged.
22. **Cloud for reports (owner-approved 2026-09-27).** Eval: cloud qwen3-30b-a3b 11/12 acceptable, p50 3.2 s vs local qwen3:4b 7/12, 22 s. Live AND weekly batch use the Worker (`provider: "cloud"`); local Ollama stays as offline/fallback. `GamePlanReport.provider` (and any other provider enum) adds `"cloud"`. config.toml `[ai.batch] provider = "cloud"`; `[ai.cloud].worker_url` = deployed workers.dev URL.
    - Amended 2026-09-27: batch reports use local Ollama (free-quota budget); cloud = live only. config.toml `[ai.batch] provider = "ollama"`; the `"cloud"` provider enum value stays.
