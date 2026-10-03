"""team_season: one row per team per regular season plus an ``NFL`` row (plan §5.2.3).

Ranks: 1 = best per docs/CONTEXT.md "Rank direction", ``min`` ties, null on NFL rows and for null
metrics. Descriptive offensive metrics (pass rate, PROE) rank 1 = highest like other offense
metrics.
"""

from __future__ import annotations

import duckdb
import polars as pl

from audible_pipeline.aggregates import metrics as m

OFF_METRICS: dict[str, str] = {
    "off_epa_per_play": m.EPA_PER_PLAY,
    "off_pass_epa": m.PASS_EPA,
    "off_run_epa": m.RUN_EPA,
    "off_success_rate": m.SUCCESS_RATE,
    "off_explosive_rate": m.EXPLOSIVE_RATE,
    "off_pass_rate": m.PASS_RATE,
    "off_proe": m.PROE,
    "off_early_down_pass_rate": m.EARLY_DOWN_PASS_RATE,
    "off_third_down_conv_rate": m.THIRD_DOWN_CONV_RATE,
}
DEF_METRICS: dict[str, str] = {
    "def_epa_per_play": m.EPA_PER_PLAY,
    "def_pass_epa": m.PASS_EPA,
    "def_run_epa": m.RUN_EPA,
    "def_success_rate": m.SUCCESS_RATE,
    "def_explosive_rate": m.EXPLOSIVE_RATE,
    "def_third_down_conv_rate": m.THIRD_DOWN_CONV_RATE,
}

METRIC_COLUMNS = [
    "off_epa_per_play", "off_pass_epa", "off_run_epa", "off_success_rate", "off_explosive_rate",
    "off_pass_rate", "off_proe", "off_early_down_pass_rate", "off_third_down_conv_rate",
    "off_red_zone_td_rate",
    "def_epa_per_play", "def_pass_epa", "def_run_epa", "def_success_rate", "def_explosive_rate",
    "def_third_down_conv_rate", "def_red_zone_td_rate", "def_blitz_rate", "def_pressure_rate",
]  # fmt: skip
UNRANKED = {"season", "games", "off_plays", "def_plays"}
# Metrics where rank 1 = lowest value ("allowed" defensive metrics).
RANK_ASCENDING = {
    "def_epa_per_play", "def_pass_epa", "def_run_epa", "def_success_rate", "def_explosive_rate",
    "def_third_down_conv_rate", "def_red_zone_td_rate",
}  # fmt: skip
RANK_COLUMNS = [f"rank_{c}" for c in METRIC_COLUMNS]

BASE_COLUMNS = [
    "season", "team", "games",
    "off_plays", *METRIC_COLUMNS[:10],
    "def_plays", *METRIC_COLUMNS[10:],
]  # fmt: skip
COLUMNS = [*BASE_COLUMNS, *RANK_COLUMNS]


def build(plays: pl.DataFrame, drives: pl.DataFrame) -> pl.DataFrame:
    """``plays`` and ``drives`` must be REG-season only with coverage applied."""
    con = duckdb.connect()
    con.register("plays", plays.to_arrow())
    con.register("drives", drives.to_arrow())
    off_sel = m.select_list(OFF_METRICS)
    def_sel = m.select_list(DEF_METRICS)
    rz = "avg(touchdown::DOUBLE) FILTER (WHERE reached_red_zone)"
    df = con.sql(f"""
    WITH
    team_off AS (
      SELECT season, posteam AS team, count(*)::INTEGER AS off_plays, {off_sel}
      FROM plays GROUP BY ALL
      UNION ALL
      SELECT season, 'NFL', count(*)::INTEGER, {off_sel} FROM plays GROUP BY ALL
    ),
    team_def AS (
      SELECT season, defteam AS team, count(*)::INTEGER AS def_plays, {def_sel},
             {m.BLITZ_RATE} AS def_blitz_rate, {m.PRESSURE_RATE} AS def_pressure_rate
      FROM plays GROUP BY ALL
      UNION ALL
      SELECT season, 'NFL', count(*)::INTEGER, {def_sel}, {m.BLITZ_RATE}, {m.PRESSURE_RATE}
      FROM plays GROUP BY ALL
    ),
    rz AS (
      SELECT season, posteam AS team, {rz} AS off_red_zone_td_rate FROM drives GROUP BY ALL
      UNION ALL SELECT season, 'NFL', {rz} FROM drives GROUP BY ALL
    ),
    rz_def AS (
      SELECT season, defteam AS team, {rz} AS def_red_zone_td_rate FROM drives GROUP BY ALL
      UNION ALL SELECT season, 'NFL', {rz} FROM drives GROUP BY ALL
    ),
    games AS (
      SELECT season, team, count(DISTINCT game_id)::INTEGER AS games FROM (
        SELECT season, posteam AS team, game_id FROM plays
        UNION ALL SELECT season, defteam, game_id FROM plays
        UNION ALL SELECT season, 'NFL', game_id FROM plays
      ) GROUP BY ALL
    )
    SELECT season::INTEGER AS season, team, games.games, team_off.* EXCLUDE (season, team),
           rz.off_red_zone_td_rate, team_def.* EXCLUDE (season, team), rz_def.def_red_zone_td_rate
    FROM games
    JOIN team_off USING (season, team)
    JOIN team_def USING (season, team)
    LEFT JOIN rz USING (season, team)
    LEFT JOIN rz_def USING (season, team)
    """).pl()
    con.close()
    return add_ranks(df.select(BASE_COLUMNS))


def add_ranks(df: pl.DataFrame) -> pl.DataFrame:
    is_team = pl.col("team") != "NFL"
    ranks = []
    for col in METRIC_COLUMNS:
        value = pl.when(is_team).then(pl.col(col))
        rank = value.rank(method="min", descending=col not in RANK_ASCENDING).over("season")
        ranks.append(rank.cast(pl.Int32).alias(f"rank_{col}"))
    # NFL row last within each season.
    return df.with_columns(ranks).sort("season", pl.col("team") == "NFL", "team").select(COLUMNS)
