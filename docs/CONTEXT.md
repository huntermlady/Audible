# Audible — Domain Glossary

The single source of truth for terminology. Code, schemas, prompts, and UI copy use these terms and
definitions exactly. If you need a term that isn't here, add it (Track 0 owns this file after M0).

## Football metrics

**Play** — A row in nflverse play-by-play where `play_type ∈ {run, pass}`. Excludes kneels (`qb_kneel`), spikes (`qb_spike`), and no-play penalties. Scrambles and sacks count as **pass** plays (dropbacks). Special-teams plays are excluded from tendencies but included in 4th-down decision facts via `punt`/`field_goal` counts.

**Dropback** — A pass play, including sacks and scrambles (nflverse `qb_dropback == 1`).

**EPA (Expected Points Added)** — nflverse `epa` column: the change in expected points from before the play to after it. Reported as **EPA/play** (the mean over plays). Higher is better for the offense, and lower is better for the defense.

**Success rate** — Share of plays with `epa > 0`.

**Explosive play** — A run gaining ≥ 10 yards or a pass gaining ≥ 20 yards. **Explosive rate** = explosive plays / plays.

**Pass rate** — Dropbacks / plays.

**xpass** — nflverse's modeled probability that a play will be a dropback, given the situation.

**PROE (Pass Rate Over Expected)** — mean(`pass` − `xpass`) over plays where `xpass` is available. Positive means the team passes more than the situation predicts.

**CPOE (Completion % Over Expected)** — nflverse `cpoe`, averaged over pass attempts. Used for QBs only.

**ANY/A** — (pass yds + 20·TD − 45·INT − sack yds) / (attempts + sacks).

**Early downs** — 1st and 2nd down.

**Third-down conversion rate** — 3rd-down plays that gain a first down or TD / 3rd-down plays.

**Red-zone TD rate** — Drives reaching `yardline_100 ≤ 20` that end in a TD / such drives.

**Blitz rate** — Share of dropbacks with 5+ pass rushers (charting data; nullable by season).

**Pressure rate** — Share of dropbacks with a hurry, hit, or sack (charting data; nullable by season).

**Man rate / Zone rate** — Share of dropbacks where the defense played man or zone coverage (participation data; nullable by season).

**Pass attempt** — A dropback that ends in a throw (excludes sacks and scrambles). **Deep pass** — a pass attempt with `air_yards ≥ 20`.

**Tendency rate denominators** (`team_tendencies` columns; the mock generator and pipeline both follow these):
- per **play**: `pass_rate`, `proe`, `epa_per_play`, `success_rate`, `explosive_rate`, `shotgun_rate`, `no_huddle_rate`
- per **dropback**: `pass_epa`, `pass_success_rate`, `screen_rate`, `play_action_rate`, `sack_rate`, `blitz_rate`, `pressure_rate`, `man_rate`, `zone_rate`
- per **pass attempt**: `avg_air_yards`, `deep_pass_rate`, `pass_left_rate`, `pass_middle_rate`, `pass_right_rate`
- per **run**: `run_epa`, `run_success_rate`, `run_left_rate`, `run_middle_rate`, `run_right_rate`

Direction and charting rates use only plays where the field was recorded (run/pass direction, air yards; screen, play-action, blitz, pressure, man, zone use charted dropbacks), so left+middle+right = 1 and man+zone = 1.

A rate whose denominator is zero in a cell (for example, `run_epa` in a cell with no runs) is **null**, never 0.

**Rank direction** — Offensive metrics rank 1 = highest value. Defensive "allowed" metrics (EPA, success, explosive, conversion, red-zone TD) rank 1 = lowest value. Defensive blitz and pressure rates rank 1 = highest value, as descriptive ranks.

## Buckets (implemented once in `pipeline/buckets.py`, mirrored in `shared/factsheet/SPEC.md`)

**Down** — 1, 2, 3, 4.

**Distance bucket (`dist_bucket`)** — `short` 1–3 yds, `medium` 4–6, `long` 7–10, `very_long` 11+.

**Field zone (`field_zone`)**, by `yardline_100` (yards from the opponent's end zone):
- `backed_up` 90–99
- `own_territory` 50–89
- `opp_territory` 21–49
- `red_zone` 1–20

**Score state (`score_state`)**, by score difference from the offense's perspective:
- `trail_9plus` ≤ −9
- `trail_1_8` −8..−1
- `tied` 0
- `lead_1_8` 1..8
- `lead_9plus` ≥ 9

**Time bucket (`time_bucket`)**:
- `two_minute`: ≤ 120 s left in the 2nd or 4th quarter
- `fourth_quarter`: rest of Q4 and OT
- `normal`: everything else

**Low sample** — A tendency cell with fewer than 20 plays. It is shown with a marker; fact sheets prefer a broader grouping instead.

## Project terms

**Side** — `off` or `def`. For `def` rows, metrics describe what the defense allowed or did.

**Grouping** — Which bucket dimensions a tendency row aggregates over (`overall`, `down_dist`, `down_dist_zone`, `zone`, `score_time`, `down_dist_score_time`).

**Cell / cell key** — One row within a grouping, identified by a canonical string such as `d3-long`, `d1-medium-red_zone`, `trail_1_8-two_minute`, or `all`.

**Tendency** — Any metric in `team_tendencies` for a team, side, season, and cell.

**League baseline** — Rows with `team = "NFL"`, holding league-wide values for the same cell.

**OC / DC** — AI Offensive Coordinator and AI Defensive Coordinator. The OC recommends offensive calls; the DC recommends defensive calls.

**Situation** — The game state input to the Play-Caller: down, distance, yardline, quarter, clock, score difference, timeouts, the two teams, the season, and the role.

**Fact sheet** — The deterministic, pre-computed bundle of facts (stat ID, label, value, display string, sample size, league value) that the app hands the model. The model may only reason from it.

**Stat ID** — A fact's unique key: `{team}.{side}.{season}.{grouping}.{cell_key}.{metric}`.

**Grounded** — A number in model-written text is grounded if it matches a fact sheet value, a Situation value, or a down/quarter ordinal. **Ungrounded** numbers fail validation.

**Coordinator call** — A structured recommendation: primary call, alternatives, rationale with stat IDs, confidence, and caveats.

**Play family** — The OC's call category: `inside_run`, `outside_run`, `qb_run`, `screen`, `quick_pass`, `intermediate_pass`, `deep_pass`, `play_action`, `sneak`, `punt`, `field_goal`.

**Front / coverage shell / pressure** — The DC's call components:
- **Front:** `even`, `odd`, `bear`, `dime_sub`
- **Coverage shell:** `cover0`, `cover1`, `cover2`, `cover3`, `cover4`, `cover6`, `two_man`
- **Pressure:** `none`, `sim` (simulated pressure), `blitz`

**Game-plan report** — A pre-generated OC or DC document for one team in one upcoming game: a headline, 3–5 keys, and situational calls (`early_down`, `third_short`, `third_long`, `red_zone`, `two_minute`).

**Stale report** — A report generated for an earlier week than the current upcoming week.

**Live mode** — The browser can reach Ollama at the configured base URL, so the Play-Caller and chat run live.

**Sample mode** — Ollama isn't reachable. The UI shows pre-generated sample calls, and chat is disabled.

**Provider** — An adapter that implements the provider interface (`ollama`, `claude`, `claude-dev`).

**Batch vs live** — Batch is the weekly report job, where slowness is fine. Live is the interactive Play-Caller and chat, which are latency-bound.

**Stats as of** — The date of the latest game included in `data/`.

## Terms to avoid

- "Prediction" or "projection" for coordinator output. Use **call** or **recommendation**.
- "Plays" to mean all nflverse rows. Plays are defined above.
- "Aggressiveness" without a metric. Name the metric: PROE, blitz rate, and so on.
