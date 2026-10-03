# audible-pipeline (Track 1)

Offline pipeline: nflverse (via `nflreadpy`) → cleaned plays → DuckDB/polars aggregates →
`data/` (zstd Parquet + JSON + `manifest.json`), per `docs/CONTRACTS.md` §4–5 and
`docs/BUILD_PLAN.md` §5.1–5.2.

```bash
make data                                   # = uv run python -m audible_pipeline build --seasons auto --out data
uv run python -m audible_pipeline build --seasons 2021-2026 --out data [--refresh] [-v]
uv run pytest pipeline                      # builds 2021, 2024, 2026 into a temp dir and checks it
AUDIBLE_VALIDATE_DIR=data uv run pytest pipeline   # run the same checks against an existing data/
AUDIBLE_OFFLINE=1 uv run pytest pipeline           # skip tests that need nflverse data
```

`--seasons auto` = `current-5 .. current`, where current = `nflreadpy.get_current_season()`.

## Layout

| Module | Role |
|---|---|
| `ingest.py` | nflreadpy loaders + raw cache `~/.cache/audible/raw/<dataset>/<season>.parquet` |
| `clean.py` | `build_plays` (the CONTEXT.md "Play" filter + buckets + charting joins), `build_drives` |
| `buckets.py` | down / dist / field-zone / score / time buckets (scalar reference + polars exprs) |
| `coverage.py` | per-season availability of optional sources; nulls out missing ones |
| `aggregates/metrics.py` | the SQL aggregate for every metric (shared by all tables) |
| `aggregates/{team_week,team_season,tendencies,players,schedule}.py` | one output each |
| `export.py` | Parquet (int32 / float64 / bool / utf8, zstd) + JSON + manifest (sha256, bytes, rows) |
| `cli.py` | `build` command |

## Cache

nflreadpy's own cache is turned off. Completed seasons are cached forever. The current season is
re-downloaded when its cached file is older than `AUDIBLE_CACHE_MAX_AGE_HOURS` (default 6).
`--refresh` forces a re-download of everything. `AUDIBLE_CACHE_DIR` overrides the location. A
dataset that nflverse doesn't publish for a season leaves a `<season>.missing` marker, which is
retried after the same max age. If a download fails and a stale file exists, the build uses the
stale file and logs a warning.

## nflreadpy findings (verified 2026-09-25, nflreadpy 0.1.5)

Functions used: `load_pbp`, `load_schedules`, `load_ftn_charting`, `load_participation`,
`load_player_stats` (default `summary_level="week"`), `get_current_season`. All return polars
DataFrames. A season outside a dataset's range raises `ValueError`.

**pbp** (372 columns): `play_type` ∈ {run, pass, punt, field_goal, kickoff, extra_point,
qb_kneel, qb_spike, no_play, null}. Kneels and spikes have their own `play_type`, so the
`{run, pass}` filter already excludes them, along with no-play penalties.
**Scrambles have `play_type = "run"` and `qb_dropback = 1`** (about 1,150 per season). The pipeline
uses `qb_dropback` as the pass flag. Two-point tries have `play_type` run/pass, `down = null`, and
a non-null `epa`, so the pipeline also requires `down` to be non-null. Other columns used: `epa`,
`xpass` (present for every play of every season), `air_yards`, `pass_location`/`run_location`
(`left|middle|right`), `shotgun`, `no_huddle` (0/1 floats), `sack`, `first_down`, `touchdown`,
`td_team`, `cpoe` (percentage points), `passer_id` (set on sacks and scrambles too),
`rusher_player_id`, `receiver_player_id`, `fixed_drive`, and `fixed_drive_result` (`Touchdown`, …).
`season_type` is REG/POST; postseason weeks are 19–22.

**Team abbreviations** (2021–2026): ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC
**LA** LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS. The Rams are `LA`.

**Schedules**: `gameday` is a `YYYY-MM-DD` string, `gametime` is `HH:MM`, and scores are null
until a game is final. `game_type` ∈ REG/WC/DIV/CON/SB.

### Optional data coverage (share of dropbacks with a value)

| Source | Field(s) | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|
| FTN charting `n_pass_rushers`, falling back to participation `number_of_pass_rushers` | `blitz_rate` (5+ rushers) | 0.997 (part.) | 1.00 | 1.00 | 0.99 | 1.00 | 0.96 |
| participation `was_pressure` | `pressure_rate` | 0.90 | 0.89 | 1.00 | 1.00 | 1.00 | — |
| participation `defense_man_zone_type` | `man_rate`, `zone_rate` | 0.89 | 0.89 | 1.00 | 1.00 | 1.00 | — |
| FTN `is_play_action` / `is_screen_pass` | `play_action_rate`, `screen_rate` | — | 1.00 | 1.00 | 1.00 | 1.00 | 0.97 |
| pbp `xpass` / `air_yards` / `cpoe` | `proe`, `avg_air_yards`, `deep_pass_rate`, `cpoe` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- FTN charting starts in 2022 (`load_ftn_charting(2021)` raises).
- Participation covers 2016–2025. **2026 is not published yet**, so 2026 `pressure_rate`,
  `man_rate`, and `zone_rate` are null until nflverse releases it. The nightly build picks it up
  automatically once it's published.
- In participation, `number_of_pass_rushers = 0` means "not charted" and is treated as missing.
  `defense_man_zone_type` is `MAN_COVERAGE`, `ZONE_COVERAGE`, or `""`/null (missing).
- A source counts as available for a season when ≥ 80% of eligible plays carry a value
  (`coverage.MIN_COVERAGE`). Otherwise every field derived from it is null for that season, never
  0, and `manifest.optional_fields_by_season` lists exactly the seasons where it's available.
  Rates use only the plays that carry a value as their denominator.

## Definitions and choices (beyond docs/CONTEXT.md)

- **Play**: a pbp row of a *final* game (the schedule has a score) with `play_type ∈ {run, pass}`,
  `down` not null, `epa` not null, and both `posteam` and `defteam` set. `is_pass = qb_dropback == 1`.
- **Season scope**: `team_season`, `team_tendencies`, and `player_season` cover the **regular
  season only**. `team_week` covers every final game, including the postseason.
- **Buckets are always from the offense's perspective**, including `side = def` rows.
- Explosive: dropbacks gaining ≥ 20 yards, other plays gaining ≥ 10 yards (a scramble counts as a
  pass). Third-down conversion: `first_down == 1`, or a TD by the offense. Red-zone TD rate: drives
  (`game_id, posteam, fixed_drive`) with a scrimmage snap at `yardline_100 ≤ 20` that ended
  `Touchdown`. Run direction rates cover designed runs (not scrambles) that have a
  `run_location`. Pass direction and air-yards metrics cover pass attempts (not sacks). Sack rate
  = sacks / dropbacks. Deep pass: `air_yards ≥ 20`.
- Every rate is an average over its own denominator. An empty denominator yields null (for
  example, `run_epa` in a cell with no runs).
- **Ranks**: rank 1 = the highest value for offense metrics (including the descriptive
  `off_pass_rate`/`off_proe`) and for `def_blitz_rate`/`def_pressure_rate`. Rank 1 = the lowest
  value for the other `def_*` metrics. Ties use `min`. Ranks are null for NFL rows and null metrics.
- **NFL rows**: `team_season` holds one per season, with def columns equal to off columns where
  symmetric. `team_tendencies` holds `side = off` only, with a cell for every (season, grouping,
  cell_key) that any team has.
- **Players**: counting stats are nflverse weekly player stats summed per (season, player, team),
  so a traded player gets one row per team. EPA/success/CPOE come from the cleaned plays:
  `epa_per_dropback` is by `passer_id` over dropbacks, `epa_per_rush` covers designed runs, and
  `epa_per_target` is by receiver. `target_share` and `air_yards_share` use the team's totals in
  the games the player played for that team. The position is the last listed one, with FB folded
  into RB, and only QB/RB/WR/TE are kept. A whole passing/rushing/receiving block is null when the
  player has no volume in it.
- `manifest.current_week` = the smallest week of `current_season` that has an unplayed game, or the
  last week once all games are played. `stats_as_of` = the latest `gameday` of a final game.

## Performance (M2, 2026-09-26)

A warm-cache `make data` for 2021–2026 takes **~2.6 s** wall time. A cold build (all downloads)
takes well under a minute. `data/` is **5.1 MB** (team_tendencies 4.4 MB, 83k rows).
