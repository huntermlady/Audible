"""team_week: one row per team per final game, regular season and postseason (plan §5.2.2)."""

from __future__ import annotations

import duckdb
import polars as pl

from audible_pipeline.aggregates import metrics as m

COLUMNS = [
    "season", "week", "game_id", "team", "opponent", "is_home", "points_for", "points_against",
    "off_plays", "off_epa_per_play", "off_success_rate", "off_pass_rate", "off_proe",
    "def_plays", "def_epa_per_play", "def_success_rate",
]  # fmt: skip


def build(plays: pl.DataFrame, schedule: pl.DataFrame) -> pl.DataFrame:
    con = duckdb.connect()
    con.register("plays", plays.to_arrow())
    games = schedule.filter(pl.col("home_score").is_not_null()).select(
        "game_id", "season", "week", "home_team", "away_team", "home_score", "away_score"
    )
    con.register("games", games.to_arrow())
    df = con.sql(f"""
    WITH sides AS (
      SELECT game_id, season, week, home_team AS team, away_team AS opponent, true AS is_home,
             home_score AS points_for, away_score AS points_against FROM games
      UNION ALL
      SELECT game_id, season, week, away_team, home_team, false, away_score, home_score FROM games
    ),
    off AS (
      SELECT game_id, posteam AS team, count(*)::INTEGER AS off_plays,
             {m.EPA_PER_PLAY} AS off_epa_per_play, {m.SUCCESS_RATE} AS off_success_rate,
             {m.PASS_RATE} AS off_pass_rate, {m.PROE} AS off_proe
      FROM plays GROUP BY ALL
    ),
    def AS (
      SELECT game_id, defteam AS team, count(*)::INTEGER AS def_plays,
             {m.EPA_PER_PLAY} AS def_epa_per_play, {m.SUCCESS_RATE} AS def_success_rate
      FROM plays GROUP BY ALL
    )
    SELECT s.season::INTEGER AS season, s.week::INTEGER AS week, s.game_id, s.team, s.opponent,
           s.is_home, s.points_for::INTEGER AS points_for,
           s.points_against::INTEGER AS points_against,
           off.* EXCLUDE (game_id, team), def.* EXCLUDE (game_id, team)
    FROM sides s
    JOIN off USING (game_id, team)
    JOIN def USING (game_id, team)
    ORDER BY season, week, game_id, team
    """).pl()
    con.close()
    return df.select(COLUMNS)
