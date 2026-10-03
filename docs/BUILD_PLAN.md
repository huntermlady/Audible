# Audible — Build Plan

> NFL analytics & visualization site with an AI Offensive Coordinator and AI Defensive Coordinator.
> Status: **plan approved 2026-09-25, no application code yet.**
> Read `docs/CONTEXT.md` before writing any code — it defines every football and project term used here.

---

## 1. What we're building and why

**Audible** is a single-user, portfolio-grade web app that turns public NFL play-by-play data into
team, matchup, and player analytics — and puts two AI "coordinators" on top of it:

- **AI Offensive Coordinator (OC)** — given a situation or an opponent, recommends how to attack.
- **AI Defensive Coordinator (DC)** — the mirror: how to defend a given offense or situation.

**Why:** to demonstrate end-to-end skill (data engineering, analytics, LLM integration, frontend design)
in something genuinely fun to use. The differentiator is **grounding**: the coordinators reason over
precomputed stats and every number shown to the user comes from the data, never from the model.

**Non-goals (v1):** user accounts, live in-game data, betting features, mobile apps, paid data feeds,
a hosted server of any kind.

### Decisions log (from the design interview)

| # | Decision |
|---|---|
| Audience | Single user, no auth; polished enough to demo publicly |
| Hosting | GitHub Pages (static) at `huntermlady.github.io/Audible`; tested locally first; **public repo** |
| Data | nflverse via `nflreadpy`; **current season + prior 5**; shipped as precomputed aggregates only |
| Architecture | Static-first: Python offline pipeline → Parquet/JSON → React app queries in-browser via DuckDB-WASM |
| AI modes | Situational Play-Caller (live), Chat drawer (live), Game-Plan Reports (pre-generated weekly) |
| AI runtime | Ollama on the owner's M2/8 GB Mac; provider interface with Claude as drop-in adapter |
| AI grounding | App builds a **fact sheet** of stat IDs; model returns schema-valid JSON citing IDs; UI renders numbers from the fact sheet |
| Refresh | Nightly GitHub Action for stats; weekly (Tue night) local Mac job for AI reports |
| Frontend | React + Vite + TS + Tailwind + shadcn/ui; Recharts + custom SVG field component |
| Look | Neutral "analytics tool" base; accent = selected team's color (contrast-checked); system-default theme + persisted toggle |
| Quality bar | 12 eval scenarios; failing 2 criteria → that stage swaps to Claude |
| Accessibility | WCAG AA contrast in both themes, full keyboard nav; desktop-first, usable at 375 px |
| Attribution | nflverse credited in footer |

---

## 2. Tech stack and architecture

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Python | 3.12, managed with **uv** | venv at `~/.venvs/audible`, symlinked to `.venv` (keeps it off iCloud) |
| Data ingest | `nflreadpy` | nflverse's Python loader. Verify function names against its docs at build time |
| Transform | **polars** + **duckdb** (Python) | polars for frames, duckdb for GROUPING SETS aggregates |
| Serialization | **pyarrow** Parquet (zstd), JSON | |
| Models / validation | **pydantic v2**, generated from JSON Schema by `datamodel-code-generator` | |
| AI (Python) | `httpx` → Ollama REST; `anthropic` SDK for the Claude adapter | |
| Lint / type | ruff, pyright | |
| Web | React 19, Vite, TypeScript (strict), Tailwind v4, shadcn/ui | |
| Routing | React Router (BrowserRouter, `basename="/Audible"`), `404.html` = copy of `index.html` for deep links | |
| Data in browser | `@duckdb/duckdb-wasm` + TanStack Query | Parquet fetched lazily per page |
| Charts | Recharts (via shadcn chart components) + custom SVG `<Field>` | |
| AI (TS) | `fetch` → Ollama REST; `ajv` validates responses against shared schemas | |
| TS types | `json-schema-to-typescript` from `shared/schemas` | |
| Tests | pytest, Vitest, Playwright, `make eval` | |
| CI/CD | GitHub Actions: `ci.yml`, `nightly-data.yml`, `deploy.yml` (actions/deploy-pages) | |
| Local scheduling | launchd plist for the weekly report job | |

### Architecture

```
                          ┌──────────────────────── GitHub ────────────────────────┐
 nflverse releases ──►    │  nightly-data.yml (cron)                                │
                          │    pipeline/ (Python) → data/*.parquet, *.json          │
                          │    + reports/ (committed) → deploy.yml → GitHub Pages   │
                          └─────────────────────────────────────────────────────────┘
                                                   ▲ git push reports/
 Owner's Mac (weekly, Tue night, launchd)          │
   ai/ batch job: read data/ → build fact sheets → Ollama (batch model) → validate → reports/*.json

 Browser (anyone) ── huntermlady.github.io/Audible
   React app ── DuckDB-WASM ── fetch data/*.parquet, reports/*.json      (all visitors)
        │
        └── Live AI client ── http://localhost:11434 (Ollama)             (owner's machine only;
                                                                            others see Sample mode)
```

Three flows, all sharing `shared/`:

1. **Stats flow (nightly, CI):** `nflreadpy` → clean → aggregate → Parquet + JSON + `manifest.json` → deployed with the site.
2. **Report flow (weekly, local):** for each game in the upcoming week, build 4 fact sheets (home OC, home DC, away OC, away DC) → batch model → validate → write `reports/{season}/{week}/{game_id}.{team}.{role}.json` → update `reports/index.json` → commit & push → deploy.
3. **Live flow (on demand, browser):** Play-Caller or Chat → client builds fact sheet from DuckDB-WASM → Ollama at localhost → validate → render with numbers substituted from the fact sheet.

---

## 3. Project structure

```
Audible/
  README.md
  Makefile                      # single entry point for every task (see §3.1)
  config.toml                   # AI model/provider config (no secrets)
  .env.example                  # ANTHROPIC_API_KEY=  (never committed, never shipped to browser)
  pyproject.toml                # uv workspace: pipeline + ai packages
  shared/                       # OWNED BY TRACK 0 — the contract
    schemas/                    # JSON Schema (draft 2020-12), one file per entity (§5)
    prompts/                    # oc_situational.md, dc_situational.md, oc_report.md, dc_report.md, chat.md
    factsheet/                  # SPEC.md + golden fixtures (input → expected fact sheet) used by BOTH languages
    scenarios/                  # 12 eval scenarios (§5.6)
    fixtures/                   # realistic MOCK data matching schemas (all 32 teams, 2 seasons)
    teams.json                  # abbr, names, colors, conference/division (static reference data)
  pipeline/                     # TRACK 1
    src/audible_pipeline/
      ingest.py                 # nflreadpy loaders, local cache under ~/.cache/audible
      clean.py                  # filters (real plays only, no kneels/spikes for tendencies, etc.)
      buckets.py                # down/distance/field-zone/score/time bucketing (per CONTEXT.md)
      aggregates/               # team_week.py, team_season.py, tendencies.py, players.py, schedule.py
      export.py                 # parquet/json writers, manifest.json with sha256 + row counts
      coverage.py               # per-season availability report for optional data (charting, participation)
      cli.py                    # `python -m audible_pipeline build --seasons 2021-2026`
    tests/                      # unit + golden-number tests
  ai/                           # TRACK 2
    src/audible_ai/
      providers/                # base.py (Protocol), ollama.py, claude.py
      factsheet.py              # builds fact sheets from data/ per shared/factsheet/SPEC.md
      grounding.py              # number validator (§5.5)
      prompts.py                # loads shared/prompts, renders templates
      reports.py                # weekly batch job
      eval.py                   # runs shared/scenarios, writes eval/results/<timestamp>.json
      cli.py                    # `python -m audible_ai reports --week auto`, `... eval`
    launchd/com.audible.weekly-reports.plist
    tests/
  web/                          # TRACKS 3 & 4
    index.html                  # includes inline no-flash theme script
    public/                     # 404.html generated at build
    src/
      app/                      # TRACK 3: router, layout, providers, error boundary
      design/                   # TRACK 3: tokens.css, theme provider, team accent, ThemeToggle
      components/ui/            # TRACK 3: shadcn components
      components/field/         # TRACK 3: <Field> SVG component
      components/charts/        # TRACK 3: themed chart wrappers (Line, Bar, Heatmap, Scatter)
      data/                     # TRACK 3: duckdb client, manifest loader, typed query hooks
      ai/                       # TRACK 4 (built on Track 2's TS contract): providers, factsheet.ts, grounding.ts, useCoordinator
      pages/                    # TRACK 4: Dashboard, Team, Matchup, PlayCaller, Players
      features/chat/            # TRACK 4: ChatDrawer
      types/generated/          # generated from shared/schemas — never hand-edited
    tests/                      # Vitest
    e2e/                        # Playwright
  data/                         # BUILD OUTPUT — gitignored; produced by pipeline, copied into site at deploy
  reports/                      # COMMITTED — AI game-plan reports + index.json
  eval/results/                 # committed eval runs (small JSON) for history
  docs/
    BUILD_PLAN.md               # this file
    CONTEXT.md                  # glossary — source of truth for terms
    adr/                        # architecture decision records (0001-static-first.md, ...)
    CONTRACT_CHANGES.md         # append-only log of any schema change after M0
  .github/workflows/ci.yml, nightly-data.yml, deploy.yml
```

### 3.1 Makefile targets (the interface every agent and the owner uses)

| Target | Does |
|---|---|
| `make setup` | uv sync (venv at `~/.venvs/audible`), `npm ci` in `web/`, pre-commit hooks |
| `make types` | regenerate pydantic + TS types from `shared/schemas` |
| `make check-types` | regenerate to a temp dir and diff; fails if committed types are stale |
| `make data` | run the pipeline for the configured seasons → `data/` |
| `make mock-data` | copy `shared/fixtures` → `data/` (lets web/AI work without the pipeline) |
| `make reports` | weekly batch report job (needs Ollama) |
| `make eval` | run the 12 scenarios for live + batch configs; print scorecard |
| `make web` | Vite dev server with `data/` and `reports/` served at `/Audible/data`, `/Audible/reports` |
| `make build` | production build of `web/` with data + reports copied into `dist/` |
| `make preview` | serve `dist/` at `http://localhost:4173/Audible/` (closest to Pages) |
| `make test` | pytest + vitest |
| `make e2e` | Playwright against `make preview` |
| `make lint` | ruff, pyright, eslint, tsc --noEmit |

---

## 4. Key components and how they interact

### 4.1 Pipeline (Python, Track 1)
- **Ingest** play-by-play, schedules, rosters/players, and (where available) FTN charting and participation data for `seasons = current-5 .. current`. Cache raw downloads locally; CI caches between runs.
- **Clean**: keep plays where `play_type ∈ {run, pass}` for tendencies (exclude kneels, spikes, penalties with no play; include scrambles as pass/dropbacks per CONTEXT.md).
- **Bucket** every play (down, distance bucket, field zone, score state, time bucket) — definitions in CONTEXT.md; implemented once in `buckets.py` and mirrored exactly in `shared/factsheet/SPEC.md`.
- **Aggregate** into the files in §5.2. Tendencies use DuckDB `GROUPING SETS` over a fixed list of groupings (§5.2.4), not a full cube, to keep cells meaningful.
- **League baseline rows** (`team = "NFL"`) are emitted for every aggregate so the UI and fact sheets can compare to average.
- **Coverage report**: `coverage.py` records which optional fields exist per season; missing → column is null and `manifest.json` lists it, never fabricated.
- **Export** with a `manifest.json` that the web app reads first.

### 4.2 AI layer (Python batch + TS live, Track 2 owns the design, Track 4 owns web wiring)
- **Provider interface** (§5.4) — `ollama` and `claude` adapters in Python; `ollama` adapter in TS, plus a **dev-only** Claude adapter that goes through a Vite dev-server proxy which injects the key from `.env` server-side. Production builds contain no Claude code path and no key.
- **Fact sheet builder** — deterministic function `(situation | matchup, data tables) → FactSheet`. Implemented in Python and TS against `shared/factsheet/SPEC.md`; **both** implementations must pass the same golden fixtures in `shared/factsheet/`.
- **Prompts** — markdown templates in `shared/prompts/`, placeholders `{{fact_sheet}}`, `{{situation}}`, `{{schema}}`. Model is asked for JSON only; Ollama's `format` parameter is set to the response JSON Schema.
- **Validation pipeline** — (1) JSON Schema validation, (2) every `stat_ids` entry exists in the fact sheet, (3) number-grounding check (§5.5). On failure: one retry with the validation errors appended; second failure → error state (live) or `validation_status: "failed"` report that the UI hides (batch).
- **Rendering rule** — UI shows stat values by looking up cited IDs in the fact sheet. Rationale text is shown as written only after passing the grounding check.
- **Live mode detection** (browser) — `GET http://localhost:11434/api/tags` with 1.5 s timeout on app load and when the user clicks "Retry". Result held in an `AIStatus` context: `live | sample | error`. Settings popover (persisted in localStorage) lets the owner change base URL and model.
- **Sample mode** — when not live, Play-Caller shows a precomputed example (`reports/samples/playcaller.json`, produced by the batch job) with a banner "Live AI runs on the owner's machine — this is a sample call." Chat drawer shows the same banner and is read-only.

### 4.3 Web shell & design system (Track 3)
- **Theme**: CSS custom properties in `tokens.css` on `:root` and `.dark`; `ThemeProvider` with `system | light | dark`, persisted in localStorage (wrapped in try/catch), inline script in `index.html` applies the class before paint (no flash).
- **Team accent**: `useTeamAccent(teamAbbr)` sets `--accent` / `--accent-foreground` from `teams.json`, choosing primary vs secondary color (or a lightened/darkened variant) so contrast vs the surface is ≥ 3:1 for UI elements and ≥ 4.5:1 where accent is used for text. Falls back to neutral accent when no team is selected.
- **Layout**: top bar (logo, nav, season selector, AI status pill, theme toggle), content area, chat drawer on the right (sheet on mobile), footer with nflverse attribution and "stats as of".
- **Data client**: single DuckDB-WASM instance, lazy-registers Parquet files by URL from the manifest, exposes typed hooks (`useTeamSeason`, `useTendencies`, `useTeamWeek`, `usePlayers`, `useSchedule`, `useReport`). Hooks are the **only** way pages touch data.
- **Charts**: wrappers that read theme tokens so every chart re-themes on toggle; a shared tooltip; categorical palette validated for both themes.
- **`<Field>`**: responsive SVG football field (endzones, yard lines, hash marks) with props for zone shading (heatmap by field zone), direction arrows (left/middle/right run/pass), and a ball-spot marker. Used on Team, Matchup, Play-Caller.

### 4.4 Pages (Track 4)

| Route | Content | Data | AI |
|---|---|---|---|
| `/` Dashboard | Current-week schedule cards; top/bottom 5 offenses & defenses by EPA/play; league scatter (off vs def EPA); featured matchup teaser | `schedule`, `team_season`, `team_week`, `reports/index.json` | Link to featured report |
| `/team/:abbr` | Header in team accent; season KPIs with ranks; EPA/play & success-rate trend by week; PROE; tendency heatmap (down × distance) with offense/defense toggle; field-zone `<Field>`; run-direction chart | `team_season`, `team_week`, `team_tendencies` | "Ask the OC/DC about this team" opens chat with context |
| `/matchup/:season/:week/:gameId` | Side-by-side team comparison; unit-vs-unit bars (Team A offense vs Team B defense); four report tabs (A OC, A DC, B OC, B DC) with cited-stat chips that open the underlying chart | same + `reports/...` | Pre-generated reports (all visitors) |
| `/play-caller` | Situation form (§5.3.1) with `<Field>` ball spot; OC/DC toggle; result card: primary call, alternatives, rationale bullets with stat chips, confidence | `team_tendencies` | Live (owner) / Sample (others) |
| `/players` | Position tabs (QB/RB/WR/TE); sortable leaderboard with min-volume filter; player card drawer with season splits | `player_season` | — |
| Chat drawer (global) | Conversation seeded with current page context (team, matchup, or situation) | via fact sheet | Live only |

Every page: loading skeletons, empty states, error boundary with retry, and works in both themes.

### 4.5 Interaction summary

```
shared/schemas ──generates──► pydantic models (pipeline, ai)   ──► TS types (web)
shared/factsheet/SPEC.md ──implemented by──► ai/factsheet.py  &  web/src/ai/factsheet.ts  (same golden tests)
pipeline ──writes──► data/  ──read by──► ai batch job, web data client
ai batch ──writes──► reports/ ──read by──► web Matchup page, Dashboard
web live ──calls──► Ollama (localhost) with prompts from shared/prompts
```

---

## 5. Data models and API contracts

All contracts live in `shared/schemas/*.schema.json` (JSON Schema 2020-12). The tables below are the
normative column lists; Track 0 turns them into schemas. **Nullable** fields are marked `?`.
Rates are fractions `0..1`; EPA values are points per play.

### 5.1 `manifest.json`

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-09-25T10:04:11Z",
  "stats_as_of": "2026-09-22",
  "current_season": 2026,
  "current_week": 4,
  "seasons": [2021, 2022, 2023, 2024, 2025, 2026],
  "files": {
    "team_season":     {"path": "team_season.parquet",     "sha256": "…", "bytes": 81234, "rows": 198},
    "team_week":       {"path": "team_week.parquet",       "sha256": "…", "bytes": 0, "rows": 0},
    "team_tendencies": {"path": "team_tendencies.parquet", "sha256": "…", "bytes": 0, "rows": 0},
    "player_season":   {"path": "player_season.parquet",   "sha256": "…", "bytes": 0, "rows": 0},
    "schedule":        {"path": "schedule.json",           "sha256": "…", "bytes": 0, "rows": 0}
  },
  "optional_fields_by_season": { "blitz_rate": [2022, 2023, 2024, 2025, 2026], "man_rate": [2023, 2024] }
}
```

### 5.2 Data files

#### 5.2.1 `schedule.json` — array of
`game_id` (nflverse id, e.g. `2026_04_KC_BAL`), `season`, `week`, `game_type` (`REG|WC|DIV|CON|SB`), `gameday` (date), `gametime?`, `home_team`, `away_team`, `home_score?`, `away_score?`, `stadium?`, `spread_line?`, `total_line?`.

#### 5.2.2 `team_week.parquet` — one row per team per game
`season, week, game_id, team, opponent, is_home, points_for, points_against, off_plays, off_epa_per_play, off_success_rate, off_pass_rate, off_proe?, def_plays, def_epa_per_play, def_success_rate`

#### 5.2.3 `team_season.parquet` — one row per team per season (+ `NFL` rows)
`season, team, games, off_plays, off_epa_per_play, off_pass_epa, off_run_epa, off_success_rate, off_explosive_rate, off_pass_rate, off_proe?, off_early_down_pass_rate, off_third_down_conv_rate, off_red_zone_td_rate, def_plays, def_epa_per_play, def_pass_epa, def_run_epa, def_success_rate, def_explosive_rate, def_third_down_conv_rate, def_red_zone_td_rate, def_blitz_rate?, def_pressure_rate?` plus `rank_<metric>` columns (1 = best, direction per metric as defined in CONTEXT.md) for every numeric metric.

#### 5.2.4 `team_tendencies.parquet` — the core AI input
Key columns:
`season, team, side (off|def), grouping, down?, dist_bucket?, field_zone?, score_state?, time_bucket?, cell_key`

`grouping` ∈ fixed list (a GROUPING SETS row only fills its own dimensions; others null):

| grouping | dimensions |
|---|---|
| `overall` | — |
| `down_dist` | down, dist_bucket |
| `down_dist_zone` | down, dist_bucket, field_zone |
| `zone` | field_zone |
| `score_time` | score_state, time_bucket |
| `down_dist_score_time` | down, dist_bucket, score_state, time_bucket |

`cell_key` = canonical string of the filled dimensions, e.g. `d3-long`, `d1-medium-red_zone`, `trail_1_8-two_minute`, `all`.

Metric columns (for `side=def` these describe what the defense *allowed/did*):
`plays, low_sample (plays < 20), pass_rate, proe?, epa_per_play, success_rate, explosive_rate, pass_epa, run_epa, pass_success_rate, run_success_rate, avg_air_yards?, deep_pass_rate?, screen_rate?, play_action_rate?, shotgun_rate, no_huddle_rate, run_left_rate, run_middle_rate, run_right_rate, pass_left_rate, pass_middle_rate, pass_right_rate, sack_rate, blitz_rate?, pressure_rate?, man_rate?, zone_rate?`

#### 5.2.5 `player_season.parquet` — one row per player per season per team
`season, player_id, player_name, team, position, games`
- passing: `pass_att?, completions?, pass_yds?, pass_td?, interceptions?, sacks?, epa_per_dropback?, cpoe?, any_a?`
- rushing: `rush_att?, rush_yds?, rush_td?, epa_per_rush?, rush_success_rate?`
- receiving: `targets?, receptions?, rec_yds?, rec_td?, epa_per_target?, target_share?, air_yards_share?, yac_per_rec?`

#### 5.2.6 `shared/teams.json` (static, hand-maintained)
`abbr, name, nickname, conference, division, color_primary (#hex), color_secondary (#hex), logo? (none in v1 — use monogram)`

### 5.3 AI contracts

#### 5.3.1 `Situation`
```json
{
  "role": "OC",                 // "OC" | "DC"
  "offense": "KC", "defense": "BAL",
  "season": 2026,               // which season's tendencies to use
  "down": 3, "distance": 7,     // 1..4, 1..99
  "yardline_100": 35,           // yards from opponent end zone, 1..99; distance <= yardline_100
  "quarter": 4,                 // 1..5 (5 = OT)
  "clock_seconds": 130,         // remaining in quarter, 0..900
  "score_diff": -4,             // offense perspective
  "timeouts_offense": 1, "timeouts_defense": 2
}
```

#### 5.3.2 `FactSheet`
```json
{
  "fact_sheet_version": "1.0.0",
  "context": { "kind": "situation", "situation": { … } },    // or { "kind": "matchup", "game_id": … , "team": …, "role": … }
  "derived": { "down": 3, "dist_bucket": "long", "field_zone": "opp_territory", "score_state": "trail_1_8", "time_bucket": "two_minute" },
  "facts": [
    { "id": "BAL.def.2026.down_dist.d3-long.blitz_rate", "label": "BAL blitz rate on 3rd & long", "value": 0.41, "display": "41%",
      "unit": "rate", "n": 58, "low_sample": false, "league_value": 0.29, "league_display": "29%" }
  ]
}
```
- **Stat ID format:** `{team}.{side}.{season}.{grouping}.{cell_key}.{metric}` — unique, deterministic, human-readable.
- Selection rules (which cells/metrics, how many facts, max ~40 facts / ~2k tokens, low-sample handling, fallback from narrow to broader grouping) are specified in `shared/factsheet/SPEC.md` by Track 0 and are identical across languages.
- `display` is pre-formatted by the builder; the UI never re-formats model output.

#### 5.3.3 `CoordinatorCall` (response for Play-Caller; also embedded in reports)
```json
{
  "role": "OC",
  "primary": {
    "play_family": "intermediate_pass",   // OC enum: inside_run | outside_run | qb_run | screen | quick_pass | intermediate_pass | deep_pass | play_action | sneak | punt | field_goal
    "direction": "right",                 // left | middle | right | null
    "concept": "Levels vs. expected pressure; hot throw to slot",
    // DC-only fields (null for OC): front (even|odd|bear|dime_sub), coverage_shell (cover0|cover1|cover2|cover3|cover4|cover6|two_man), pressure (none|sim|blitz)
    "front": null, "coverage_shell": null, "pressure": null
  },
  "alternatives": [ { "play_family": "screen", "direction": "left", "concept": "…", "when": "If they show 6+ at the line" } ],
  "rationale": [ { "text": "Baltimore blitzes far more than league average on 3rd and long.", "stat_ids": ["BAL.def.2026.down_dist.d3-long.blitz_rate"] } ],
  "confidence": "medium",                 // low | medium | high
  "caveats": [ "Blitz data is from 58 plays." ]
}
```
Rules: `rationale` 2–5 items, each with ≥ 1 valid `stat_id`; `alternatives` 0–2.

#### 5.3.4 `GamePlanReport` — `reports/{season}/{week}/{game_id}.{team}.{role}.json`
```json
{
  "report_version": "1.0.0",
  "game_id": "2026_04_KC_BAL", "season": 2026, "week": 4,
  "team": "KC", "opponent": "BAL", "role": "OC",
  "generated_at": "2026-09-29T03:12:00Z", "stats_as_of": "2026-09-28",
  "provider": "ollama", "model": "qwen3:8b",
  "validation_status": "passed",          // passed | failed  (failed reports are not shown)
  "fact_sheet": { … FactSheet … },
  "headline": "Attack Baltimore's aggressive 3rd-down pressure with quick game and screens.",
  "keys": [ { "title": "…", "detail": "…", "stat_ids": ["…"] } ],                     // 3–5
  "situational_calls": {                   // each a CoordinatorCall
    "early_down": { … }, "third_short": { … }, "third_long": { … }, "red_zone": { … }, "two_minute": { … }
  }
}
```
`reports/index.json`: array of `{ season, week, game_id, team, opponent, role, path, generated_at, stats_as_of, model, validation_status }`.
The UI marks a report **stale** when its `week` < `manifest.current_week`'s upcoming week.
`reports/samples/playcaller.json`: `{ situation, fact_sheet, call: CoordinatorCall, generated_at, model }` (3–5 samples; UI picks one).

#### 5.3.5 Chat
- Request: `{ context: { page: "team"|"matchup"|"play-caller"|"other", team?, opponent?, game_id?, situation? }, messages: [{ role, content }] }`
- The client builds a FactSheet for the context and prepends it as a system message. Output is streamed free text.
- Post-stream, the grounding check (§5.5) runs; any ungrounded number is **highlighted** with a "not from data" tooltip (chat is not rejected, since it streams).

### 5.4 Provider interface

Python (`ai/src/audible_ai/providers/base.py`):
```python
class Provider(Protocol):
    name: str
    model: str
    def generate_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.2,
                      timeout_s: float = 120) -> GenerateResult: ...
    def stream_text(self, system: str, messages: list[Message], *, temperature: float = 0.4) -> Iterator[str]: ...

@dataclass
class GenerateResult:
    raw_text: str
    parsed: dict | None
    latency_ms: int
    first_token_ms: int | None
    prompt_tokens: int | None
    output_tokens: int | None
```
TypeScript (`web/src/ai/providers/types.ts`) mirrors it:
```ts
interface Provider {
  name: 'ollama' | 'claude-dev';
  model: string;
  generateJson(req: { system: string; user: string; schema: object; signal?: AbortSignal }): Promise<GenerateResult>;
  streamText(req: { system: string; messages: Message[]; signal?: AbortSignal }): AsyncIterable<string>;
  health(): Promise<{ ok: boolean; models?: string[] }>;
}
```

`config.toml`:
```toml
[ai.live]
provider = "ollama"
base_url = "http://localhost:11434"
model = "qwen3:4b"          # verify current tag at build time

[ai.batch]
provider = "ollama"
model = "qwen3:8b"          # try first; fall back to a 4b model if the Mac swaps

[ai.claude]
model = "claude-sonnet-5"   # used only if a stage is switched to Claude
max_daily_usd = 2.00
```

### 5.5 Grounding check (both languages, same fixtures)
Extract every numeric token from model-authored text (regex for integers, decimals, percentages, and `x-y` scores).
A number is **grounded** if it matches (within display rounding) any of:
- a fact `display` or `value` in the fact sheet (including `league_display`),
- a value in the `Situation` (down, distance, yardline, quarter, clock as m:ss, score_diff, timeouts),
- integers 1–4 used as down/quarter ordinals ("3rd").

Anything else → ungrounded. Structured calls/reports with any ungrounded number fail validation.

### 5.6 Eval scenarios (`shared/scenarios/*.json`)
12 files: 6 OC + 6 DC covering short yardage, 3rd & long, red zone, two-minute, backed up, and one 4th-down decision per side.
```json
{
  "id": "oc-03-third-long-vs-blitz",
  "situation": { … Situation … },
  "data": "fixtures",                         // run against shared/fixtures for reproducibility
  "acceptable_play_families": ["quick_pass", "screen", "intermediate_pass"],
  "unacceptable_play_families": ["inside_run", "sneak", "punt"],
  "notes_for_human_rater": "Heavy blitz tendency — expect hot/quick answers."
}
```
`make eval` output per model config: JSON-valid %, grounded %, acceptable-family %, p50/p95 first-token and total latency; plus a prompt to record the owner's human rating (`defensible: y/n`) into `eval/results/`.

---

## 6. Work breakdown for agents

### Rules for all agents
1. **Own your paths.** Only edit paths your track owns (table below). Need a change elsewhere? Leave a note in `docs/HANDOFFS.md` for the owner track.
2. **Contracts are frozen after M0.** Changing `shared/` after M0 requires: edit schema → `make types` → entry in `docs/CONTRACT_CHANGES.md` → all tracks' tests still pass.
3. **Use the vocabulary in `docs/CONTEXT.md`.** Don't invent synonyms.
4. **Work on a branch per track** (`track/1-pipeline`, …), ideally in separate git worktrees; merge to `main` via PR with CI green.
5. **No secrets in the repo or the web bundle.** `.env` is gitignored.
6. **Never place venvs or `node_modules` under `~/Desktop`.** The repo's real path is `~/Projects/Audible`.

### Tracks

| # | Track | Owns | Starts after |
|---|---|---|---|
| 0 | Contracts & scaffolding | `shared/`, `Makefile`, `pyproject.toml`, `config.toml`, `.github/workflows/ci.yml`, `docs/CONTEXT.md` edits, `web/src/types/generated/`, repo scaffolding | — |
| 1 | Pipeline | `pipeline/`, `.github/workflows/nightly-data.yml` | M0 |
| 2 | AI core | `ai/`, `shared/prompts/` (after M0, co-owned with Track 0), TS modules in `web/src/ai/{providers,factsheet.ts,grounding.ts}` | M0 |
| 3 | Web shell & design system | `web/` except `src/pages`, `src/features`, `src/ai` | M0 |
| 4 | Web feature pages | `web/src/pages/`, `web/src/features/`, `web/src/ai/useCoordinator.ts` + UI glue | M0 + Track 3's shell (M1a) |
| 5 | Integration & deploy | `.github/workflows/deploy.yml`, `web/e2e/`, `README.md`, `docs/adr/` | Tracks 1–4 at M2 |

#### Track 0 — Contracts & scaffolding
Deliverables:
- Repo skeleton per §3; `make setup/types/check-types/mock-data/test/lint` working.
- All schemas in §5 as JSON Schema; generated pydantic + TS types committed.
- `shared/factsheet/SPEC.md` (selection rules) + ≥ 6 golden fixtures (input → expected fact sheet).
- `shared/fixtures/`: mock data for **all 32 teams, 2 seasons**, statistically plausible (EPA/play ≈ −0.25..+0.25, rates in realistic ranges), including a few `low_sample` cells and nulls in optional fields; 2 mock reports and 3 playcaller samples.
- `shared/teams.json` with real team colors.
- `shared/scenarios/` — all 12 scenarios.
- `shared/prompts/` first drafts.
- `ci.yml`: lint, type-check, `check-types`, pytest, vitest.

Acceptance:
- [ ] `make setup && make mock-data && make test && make lint` pass on a clean clone.
- [ ] Every fixture file validates against its schema (a test enforces this).
- [ ] `make check-types` fails if a schema is edited without regenerating.

#### Track 1 — Pipeline
Deliverables: everything in §4.1 producing §5.1–5.2.5; nightly workflow that builds `data/`, uploads it as an artifact, and triggers `deploy.yml`.

Acceptance:
- [ ] `make data` builds all files for 6 seasons in < 10 min on the M2 (warm cache) and < 20 min in CI.
- [ ] All outputs validate against schemas; `manifest.json` hashes and row counts are correct.
- [ ] **Golden-number tests:** for ≥ 3 team-seasons, `off_epa_per_play` and `off_success_rate` match nflverse-derived reference values computed independently in the test (±0.005), and the play-count filters match CONTEXT.md.
- [ ] Bucketing unit tests cover every boundary (e.g., distance 3/4, 6/7, 10/11; yardline 20/21, 49/50, 89/90; score diff 0/±1/±8/±9; clock 2:00).
- [ ] `NFL` baseline rows exist for every season/grouping.
- [ ] Optional fields are null (never zero) where the source lacks them, and `optional_fields_by_season` reports them.
- [ ] Total `data/` size < 75 MB.
- [ ] Nightly workflow runs on cron (daily Sep–Feb, weekly otherwise) and on manual dispatch.

#### Track 2 — AI core
Deliverables: provider interface + Ollama & Claude adapters (Python), Ollama + dev-only Claude adapters (TS), fact sheet builders (Py + TS), grounding validator (Py + TS), prompts, batch report job, eval harness, launchd plist with install instructions.

Acceptance:
- [ ] Py and TS fact sheet builders produce byte-identical JSON for every golden fixture.
- [ ] Py and TS grounding validators agree on a shared test set of ≥ 30 strings.
- [ ] `make reports WEEK=<n>` against fixtures produces 4 reports per game, all schema-valid, `reports/index.json` updated; failed validations retried once, then written with `validation_status: "failed"`.
- [ ] A full week's batch run (~64 reports) completes unattended on the M2.
- [ ] `make eval` produces the scorecard in §5.6 for both `ai.live` and `ai.batch` configs.
- [ ] Switching a stage to Claude is a `config.toml` change only; the Claude adapter respects `max_daily_usd` by tracking spend in a local file.
- [ ] Production web build contains no reference to the Claude adapter or `ANTHROPIC_API_KEY` (a test greps `dist/`).
- [ ] launchd job runs Tuesday 23:00 local, runs `make data` (or pulls the latest data artifact), then `make reports`, commits `reports/`, and pushes; logs to `~/Library/Logs/audible-reports.log`; exits cleanly with a logged message if Ollama is not running.

#### Track 3 — Web shell & design system
Deliverables: §4.3 in full; a `/dev/kitchen-sink` route (dev builds only) showing every component and chart in both themes with and without a team accent.

Acceptance:
- [ ] Theme toggle cycles system → light → dark, persists across reload, no flash of the wrong theme on load (Playwright check of the first-paint class).
- [ ] All 32 team accents pass contrast checks (≥ 3:1 UI, ≥ 4.5:1 text) in both themes — enforced by a unit test over `teams.json`.
- [ ] Charts and `<Field>` re-theme instantly on toggle, with no hard-coded colors (lint rule or test).
- [ ] Data hooks load only the Parquet files a page needs (verified via network log in e2e).
- [ ] First Dashboard render with mock data < 2.5 s on `make preview` (cold cache, desktop).
- [ ] Layout has no horizontal scroll at 375 px; every interactive element is keyboard reachable with a visible focus ring.

#### Track 4 — Web feature pages
Deliverables: all routes in §4.4, the chat drawer, `useCoordinator` (situation → fact sheet → provider → validate → render), AI status handling, and sample mode.

Acceptance:
- [ ] Every page renders against mock data and real data with no console errors, in both themes.
- [ ] Every number shown in AI output is rendered from a fact sheet `display` value; clicking a stat chip shows the underlying chart or table cell.
- [ ] Play-Caller validates input (e.g., distance ≤ yardline_100, clock ranges) with inline errors.
- [ ] With Ollama stopped: Play-Caller shows a sample call with the banner, chat is disabled with an explanation, and there are no errors or infinite spinners.
- [ ] With Ollama running: live call first token < 3 s and full result < 20 s (per the §5.6 thresholds); the user can cancel mid-request.
- [ ] Stale reports are labeled; `validation_status: "failed"` reports are never shown.
- [ ] Empty, loading, and error states exist for every data-driven component.

#### Track 5 — Integration & deploy
Deliverables: `deploy.yml` (build web, fetch the latest `data/` artifact, copy `data/` + `reports/` into `dist/`, create `404.html`, deploy to Pages), Playwright suite, README (setup, run, deploy, Ollama setup incl. `OLLAMA_ORIGINS`), ADRs 0001–0004 (static-first, fact-sheet grounding, DuckDB-WASM, local-Ollama live mode).

Acceptance:
- [ ] `huntermlady.github.io/Audible` serves the app; deep links (e.g., `/Audible/team/KC`) load directly on refresh.
- [ ] Playwright smoke tests: each route × {light, dark} × {desktop, 375 px} passes against `make preview` and against the deployed URL.
- [ ] **Live-AI-from-Pages check:** documented result of calling local Ollama from the deployed HTTPS site in Chrome and Safari (with `OLLAMA_ORIGINS=https://huntermlady.github.io`). If a browser blocks it (for example, via a local network access permission), the UI detects that and tells the owner to use `make preview` for live mode, and the README documents this.
- [ ] A fresh clone → `make setup && make data && make build && make preview` works by following the README alone.
- [ ] Deployed site total size < 150 MB.

---

## 7. Milestones

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Contracts** | Track 0 alone | Track 0 acceptance met; contracts frozen |
| **M1a — Parallel start** | Tracks 1, 2, 3 in parallel on mocks | Shell + design system merged (unblocks Track 4) |
| **M1b — Features** | Track 4 joins; 1–3 continue | All pages working on mock data |
| **M2 — Real data** | Pipeline output replaces mocks; first real batch reports | All track acceptance criteria met locally |
| **M3 — Deploy** | Track 5 | Deployed; e2e green against the live URL |
| **M4 — Tune AI** | Run `make eval`, iterate prompts and fact sheet rules, and decide Ollama vs Claude per stage | §8 AI criteria met or stage switched to Claude with the decision recorded in an ADR |

---

## 8. Global acceptance criteria (definition of done for v1)

**Product**
- [ ] Six surfaces work: Dashboard, Team, Matchup (with OC/DC reports), Play-Caller, Players, Chat drawer.
- [ ] Light/dark toggle works everywhere, defaults to system, persists, and has no flash.
- [ ] Team accent theming applies on team-scoped pages and passes contrast checks in both themes.
- [ ] Footer credits nflverse and shows "stats as of <date>".

**Data**
- [ ] Current season + prior 5 are available; the nightly Action keeps them current without manual steps.
- [ ] Golden-number tests pass; optional fields degrade to null and the UI shows "not available for this season."

**AI**
- [ ] Zero ungrounded numbers in any displayed structured AI output (enforced by the validator, verified by eval).
- [ ] Eval on the 12 scenarios: 100% schema-valid; 100% grounded; ≥ 10/12 rated defensible by the owner; live first token < 3 s and total < 20 s on the M2. Failing 2+ criteria for a stage → switch that stage to Claude.
- [ ] Weekly reports generate unattended; missing weeks degrade to labeled stale reports.
- [ ] Visitors without Ollama get sample mode, with no errors.

**Quality**
- [ ] CI green: lint, types, `check-types`, pytest, vitest, Playwright.
- [ ] WCAG AA contrast and keyboard navigation verified by an axe check in Playwright on every route in both themes.
- [ ] No secrets in the repo or the bundle; the repo is public.
- [ ] The README takes a new machine from clone to running.

---

## 9. Risks and things to verify at build time

| Risk | Mitigation / owner |
|---|---|
| Chrome/Safari block an HTTPS page from calling `http://localhost` | Track 5 verifies; fallback is live mode via `make preview`; the UI detects this and explains it |
| An 8 GB M2 is too small for good tool-free reasoning | Fact sheets keep prompts small; eval decides; Claude adapter ready |
| Model tags in `config.toml` are outdated | Track 2 confirms current Ollama tags before M1 ends |
| `nflreadpy` API differs from assumptions | Track 1 confirms function names and dataset coverage in the first step and records findings in `pipeline/README.md` |
| Charting/participation (blitz, coverage) data missing for some seasons | Nullable columns + `optional_fields_by_season`; the fact sheet omits them rather than guessing |
| Pages size limits | Aggregates only; size assertions in Track 1 and Track 5 criteria |
| The Mac is off on Tuesday night | Reports go stale gracefully; the owner can run `make reports` manually |
| Pushing from launchd needs git credentials | Track 2 documents SSH key / credential helper setup in the plist README |
| Py/TS fact sheet drift | Shared golden fixtures run in both test suites in CI |
