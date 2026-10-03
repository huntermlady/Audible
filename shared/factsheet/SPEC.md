# Fact Sheet Specification (v1.1.0)

Owner: Track 2. Implemented twice, in `ai/src/audible_ai/factsheet.py` and `web/src/ai/factsheet.ts`.
The two implementations must produce **byte-identical** JSON for every golden in `goldens/`.
Terms follow `docs/CONTEXT.md`. Contract rules are in `docs/CONTRACTS.md` §6, and schema in
`shared/schemas/fact_sheet.schema.json`.

A fact sheet is a pure function: `build(context, tendency_rows) -> FactSheet`. It reads no clock,
no randomness, and no environment.

---

## 1. Inputs

- `context` is a `FactSheetContext`: `situation`, `matchup`, or `team` (chat on team pages).
- `tendency_rows` is a list of `TeamTendencyRow` dicts. It may contain unrelated rows (other seasons,
  teams or cells). The builder ignores them.

`inputs(context)` returns `{season, seasons, teams}`, which says which rows to fetch. `season` is the
context season. `seasons` is `[season, season - 1]`: the prior season feeds the low-sample fallback
(§4). `teams` is in block order (§3), de-duplicated, and followed by `"NFL"`:
- situation: `[situation.offense, situation.defense, "NFL"]`, season `situation.season`
- matchup: `[team, opponent, "NFL"]`, season `season`
- team: `[team, "NFL"]`, season `season`

### Row lookup
A row is addressed by `(season, team, side, grouping, cell_key)`. If more than one input row has
the same address, the **first one in input order** wins.

## 2. Derived buckets (situation context only)

These mirror `pipeline/buckets.py` and CONTEXT.md exactly.

| Field | Rule |
|---|---|
| `down` | `situation.down` |
| `dist_bucket` | distance 1–3 → `short`, 4–6 → `medium`, 7–10 → `long`, ≥ 11 → `very_long` |
| `field_zone` | yardline_100 90–99 → `backed_up`, 50–89 → `own_territory`, 21–49 → `opp_territory`, 1–20 → `red_zone` |
| `score_state` | score_diff ≤ −9 → `trail_9plus`, −8..−1 → `trail_1_8`, 0 → `tied`, 1..8 → `lead_1_8`, ≥ 9 → `lead_9plus` |
| `time_bucket` | quarter ∈ {2, 4} and clock_seconds ≤ 120 → `two_minute`; else quarter ∈ {4, 5} → `fourth_quarter`; else `normal` |

`derived` is `null` for matchup and team contexts.

Cell keys (CONTRACTS §4.1): `all`, `d{down}-{dist}`, `d{down}-{dist}-{zone}`, `{zone}`,
`{score}-{time}`, `d{down}-{dist}-{score}-{time}`.

## 3. Blocks

A fact sheet has two **blocks**, and each block is one `(team, side)`. The "own" block comes first.

| Context | Block 1 (own) | Block 2 (opponent) |
|---|---|---|
| situation, role `OC` | offense, `off` | defense, `def` |
| situation, role `DC` | defense, `def` | offense, `off` |
| matchup, role `OC` | team, `off` | opponent, `def` |
| matchup, role `DC` | team, `def` | opponent, `off` |
| team | team, `off` | team, `def` |

## 4. Slots

Each block is filled by an ordered list of **slots**. A slot has:
- a **candidate list** of `(grouping, cell_key)`, ordered narrow → broad
- a flag, `required` or `optional`
- a **metric list** that depends on the block's side (§5)

**Choosing a slot's cell** (v1.1: prior-season fallback). Walk the candidates in order. For each
candidate:
1. If the context-season row exists and has `low_sample == false`, choose it.
2. Otherwise, unless the candidate is `overall/all`, look up the **prior season's** row for the same
   team, side, grouping and cell_key (season − 1). If it exists and has `low_sample == false`,
   choose it.
3. Otherwise move on to the next, broader candidate.

If nothing qualifies, a `required` slot takes the **last context-season** candidate whose row
exists, which is the broadest one. That row can have `low_sample == true`, and its facts then carry
`low_sample: true`. Prior-season rows are never chosen when low_sample. An `optional` slot is
omitted. If no candidate row exists at all, the slot is omitted.

The chosen row's own season is used for its stat IDs, its league row and its label (§7).

### 4.1 Situation slots

| # | Slot | Flag | Candidates |
|---|---|---|---|
| 1 | `situational` | required | see below |
| 2 | `zone` | optional | `zone/{zone}` |
| 3 | `score_time` | optional | `score_time/{score}-{time}` |
| 4 | `overall` | required | `overall/all` |

`situational` candidates:
- If `field_zone` ∈ {`red_zone`, `backed_up`}: `down_dist_zone/d{down}-{dist}-{zone}`,
  `down_dist_score_time/d{down}-{dist}-{score}-{time}`, `down_dist/d{down}-{dist}`, `overall/all`
- Otherwise: `down_dist_score_time/…`, `down_dist_zone/…`, `down_dist/…`, `overall/all`

### 4.2 Matchup (and team) slots

Team contexts use the same slots and metric lists as matchup contexts.

| # | Slot | Flag | Candidates |
|---|---|---|---|
| 1 | `overall` | required | `overall/all` |
| 2 | `early_down` | required | `down_dist/d1-long` |
| 3 | `third_short` | required | `down_dist/d3-short` |
| 4 | `third_long` | required | `down_dist/d3-long` |
| 5 | `red_zone` | required | `zone/red_zone` |
| 6 | `two_minute` | required | `score_time/trail_1_8-two_minute` |

## 5. Metric lists

The metrics are tendency column names, emitted in the listed order.

### Situation context

| Slot | `off` | `def` |
|---|---|---|
| situational | pass_rate, proe, success_rate, pass_success_rate, run_success_rate, epa_per_play, explosive_rate, sack_rate, screen_rate | success_rate, pass_success_rate, run_success_rate, epa_per_play, explosive_rate, sack_rate, blitz_rate, pressure_rate, man_rate |
| zone | pass_rate, success_rate, epa_per_play | success_rate, epa_per_play, pass_success_rate |
| score_time | pass_rate, success_rate, no_huddle_rate | success_rate, blitz_rate, zone_rate |
| overall | epa_per_play, success_rate, pass_rate, proe, explosive_rate | epa_per_play, success_rate, explosive_rate, blitz_rate, pressure_rate |

### Matchup and team contexts

| Slot | `off` | `def` |
|---|---|---|
| overall | epa_per_play, success_rate, pass_rate, proe, explosive_rate | epa_per_play, success_rate, explosive_rate, blitz_rate, pressure_rate |
| early_down | pass_rate, proe, success_rate, play_action_rate | success_rate, run_success_rate, pass_success_rate, explosive_rate |
| third_short | pass_rate, success_rate, run_success_rate | success_rate, run_success_rate, blitz_rate |
| third_long | pass_success_rate, sack_rate, screen_rate | pass_success_rate, blitz_rate, man_rate |
| red_zone | pass_rate, success_rate, epa_per_play | success_rate, epa_per_play, pass_success_rate |
| two_minute | pass_rate, success_rate | pass_success_rate, zone_rate |

Each block has at most 20 facts, so a sheet has at most 40.

## 6. Emitting facts

For each block → each slot (in order) → each metric (in order):
1. If the chosen row's metric is `null`, skip it. Nulls are never emitted.
2. Build the stat ID `{team}.{side}.{row season}.{grouping}.{cell_key}.{metric}`, using the chosen
   row's season (the prior season for a fallback row). If this ID was already
   emitted, skip it. For example, `situational` can fall back to `overall/all`, and the `overall` slot
   then repeats IDs.
3. Emit the fact (§7).

After all blocks, truncate to the first **40** facts. This is a safeguard; the lists above cannot
exceed it.

## 7. Fact fields

Fact keys are emitted in this exact order: `id, label, value, display, unit, n, low_sample,
league_value, league_display`.

| Field | Rule |
|---|---|
| `id` | the stat ID |
| `label` | `"{team} {offense\|defense}: {metric label}, {cell label}"` (§7.1), followed by `" ({row season})"` when the row comes from the prior season, e.g. `"BAL defense: blitz rate, 3rd & long (2025)"` |
| `value` | `round4(raw)` (§8) |
| `display` | `format(unit, value)` (§8) |
| `unit` | `epa` for `epa_per_play, pass_epa, run_epa`. `yards` for `avg_air_yards`. `count` for `plays`. `rate` for every other metric |
| `n` | the chosen row's `plays` |
| `low_sample` | the chosen row's `low_sample` |
| `league_value` | `round4` of the same metric in the `NFL` row, side `off`, with the chosen row's season and the same grouping/cell_key. It is `null` if that row is missing or the metric is null |
| `league_display` | `format(unit, league_value)`, or `null` |

### 7.1 Labels

Labels contain **no digits except down ordinals** and a prior-season suffix (a season that is also
grounded, §11.3), so the model cannot copy an ungrounded number from a label.

Metric labels:

| metric | label | metric | label |
|---|---|---|---|
| plays | plays | shotgun_rate | shotgun rate |
| pass_rate | pass rate | no_huddle_rate | no-huddle rate |
| proe | pass rate over expected | run_left_rate | share of runs left |
| epa_per_play | EPA/play | run_middle_rate | share of runs middle |
| success_rate | success rate | run_right_rate | share of runs right |
| explosive_rate | explosive-play rate | pass_left_rate | share of passes left |
| pass_epa | EPA/dropback | pass_middle_rate | share of passes middle |
| run_epa | EPA/run | pass_right_rate | share of passes right |
| pass_success_rate | dropback success rate | sack_rate | sack rate |
| run_success_rate | run success rate | blitz_rate | blitz rate |
| avg_air_yards | average air yards | pressure_rate | pressure rate |
| deep_pass_rate | deep pass rate | man_rate | man coverage rate |
| screen_rate | screen rate | zone_rate | zone coverage rate |
| play_action_rate | play-action rate | | |

The cell label is made of parts joined with `", "`:
- `all` → `all plays`
- down + dist → `{1st|2nd|3rd|4th} & {short|medium|long|very long}`
- zone: `backed_up` → `backed up`, `own_territory` → `own territory`,
  `opp_territory` → `opponent territory`, `red_zone` → `red zone`
- score: `trail_9plus` → `trailing by two scores or more`, `trail_1_8` → `trailing by one score`,
  `tied` → `tied`, `lead_1_8` → `leading by one score`, `lead_9plus` → `leading by two scores or more`
- time: `two_minute` → `two-minute`, `fourth_quarter` → `fourth quarter`, `normal` → `normal clock`

The parts are ordered down+dist, zone, score, time. Example:
`"BAL defense: blitz rate, 3rd & long, trailing by one score, two-minute"`.

## 8. Numbers and formatting (bit-exact in both languages)

`rha(x)` means round half away from zero: `sign(x) * floor(abs(x) + 0.5)`, computed in IEEE-754
double.

- `k = rha(raw * 10000)` (an integer). `round4(raw) = k / 10000`. If `k % 10000 == 0`, the value is
  serialized as an **integer** (`0`, `1`, `-1`). There is never `-0`, `1.0` or exponent notation.
- `display` is computed from the integer `k` using integer arithmetic only. Let `s = sign(k)` and
  `a = abs(k)`.
  - `rate`: `p = s * floor((a + 50) / 100)`. The display is `"{p}%"`, `"0%"` when `p == 0`, and
    `"-3%"` when negative.
  - `epa`: `c = floor((a + 50) / 100)` hundredths. If `c == 0`, the display is `"0.00"`. Otherwise it
    is `("+" if s > 0 else "-") + "{c // 100}.{c % 100:02d}"`, for example `"+0.12"` or `"-0.05"`.
  - `yards`: `t = floor((a + 500) / 1000)` tenths. The display is `("-" if s < 0 and t > 0 else "") +
    "{t // 10}.{t % 10}"`, for example `"8.4"` or `"0.0"`.
  - `count`: `str(int(raw))`.

## 9. Output shape and serialization

```
{ "fact_sheet_version": "1.0.0", "context": …, "derived": … | null, "facts": [ … ] }
```
- `context` is rebuilt in **schema property order**. situation: `{kind, situation}`, where
  `situation` keys follow `situation.schema.json` order. matchup: `{kind, game_id, season, team,
  opponent, role}`. team: `{kind, season, team}`.
- `derived` keys: `down, dist_bucket, field_zone, score_state, time_bucket`.
- Serialization: Python `json.dumps(fs, indent=2, ensure_ascii=False)`, TS
  `JSON.stringify(fs, null, 2)`. Golden files store that string followed by one `"\n"`.

## 10. Golden fixtures (`goldens/`)

Each golden is `goldens/<name>.json`:
```
{ "name": "...", "description": "...", "context": FactSheetContext, "tendencies": [TeamTendencyRow, ...] }
```
and `goldens/<name>.expected.json` holds the serialized FactSheet. The `tendencies` are taken from
`shared/fixtures` and pruned to the rows the builder can select, plus a few distractor rows (other
seasons, teams and cells) that must be ignored. `ai/scripts/make_goldens.py` regenerates the inputs.
The expected outputs are committed and reviewed. Never regenerate an expected file to make a failing
test pass without reviewing the diff.

---

## 11. Grounding (number check)

Both `grounding.py` and `grounding.ts` implement this, and both run `grounding_cases.json`.

### 11.1 Masking
Before extraction, spans that match this pattern (case-insensitive) are replaced with spaces of
equal length. They are play-call vocabulary, not statistics:
```
(?<![A-Za-z0-9_])(?:cover[ -]?[0-9]+|[0-9]+[ -]man|[0-9]{2} personnel|[0-9]-technique|[0-9]-tech)(?![A-Za-z0-9_])
```

### 11.2 Tokens
Scan the masked text left to right with this regex, which is ASCII-only in both languages:
```
(?<![A-Za-z0-9_.])(?:([0-9]{1,2}):([0-9]{2})|([0-9]+)-([0-9]+)(?![0-9])|([0-9]+)(st|nd|rd|th)(?![A-Za-z])|([+-]?)([0-9]+(?:\.[0-9]+)?|\.[0-9]+)(%?))
```
The alternatives are clock (`m:ss`), pair (`x-y`, a score or range), ordinal, and plain number. A
plain number can carry a sign, decimals and `%`. Token offsets are string indices (`start`
inclusive, `end` exclusive). Inputs are expected to be BMP-only text, so Python code points equal JS
UTF-16 units.

### 11.3 Candidates
Each candidate is a magnitude with a kind: `pct`, `frac` or `num`.
- Every fact, and every non-null league value, contributes:
  - `rate`: `(abs(value)*100, pct)`, `(abs(value), frac)`, and `(abs(display number), pct)`
  - `epa`: `(abs(value), frac)` and `(abs(display number), frac)`
  - `yards`: `(abs(value), num)`
  - `count`: `(abs(value), num)`
- Every fact contributes `(n, num)` and its stat-ID season `(season, num)`.
- Situation, if given: `down, distance, yardline_100, 100 − yardline_100, quarter, clock_seconds,
  abs(score_diff), timeouts_offense, timeouts_defense, season`, all `num`.
- Matchup or team context: `season` (`num`).
- The situation used is the one passed explicitly, else the fact sheet's own situation (situation
  context), else none.

### 11.4 Matching
- **Plain number** `x` (magnitude) with `d` decimals. Let `tol = 0.5 * 10^-d + 1e-9`.
  - With `%`: the number is grounded if `abs(x − c) ≤ tol` for some `pct` candidate.
  - Without `%`: it is grounded if that holds for some `pct` or `num` candidate, or (only when
    `d ≥ 1`) for some `frac` candidate.
- **Ordinal**: grounded if its value is 1–4.
- **Clock** `m:ss`: grounded if a situation is given and `m*60 + ss == clock_seconds`.
- **Pair** `a-b`: grounded if both `a` and `b` are grounded as plain numbers without `%`.

`grounded == (no ungrounded tokens)`. Each ungrounded token is reported as `{token, start, end}`,
where `token` is the matched text.

## 12. Validation pipeline

For structured output (a CoordinatorCall or a report body):
1. **Schema**: JSON Schema validation against the shared schema.
2. **Stat IDs**: every `stat_ids` entry exists in the fact sheet.
3. **Role**: `call.role` equals the context role. OC calls have a non-null `play_family` and null
   `front`/`coverage_shell`/`pressure`. DC calls have non-null `front`/`coverage_shell`/`pressure`
   and a null `play_family` (this applies to primary and alternatives).
4. **Grounding**: this runs on every model-authored string: `primary.concept`, alternatives'
   `concept`/`when`, `rationale[].text`, and `caveats[]`. For reports it also runs on `headline` and
   `keys[].title`/`detail`.

On failure, the model is asked once more with the error list appended. A second failure is final.

The model-facing schema is the shared schema with all `$ref`s inlined, `pattern`/`format` removed, and
every `stat_ids.items` replaced by `{"type":"string","enum":[<fact ids>]}`. Local validation always
uses the full shared schema.
