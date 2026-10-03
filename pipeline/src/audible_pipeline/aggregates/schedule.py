"""schedule.json rows (plan §5.2.1): every game of every season, future games with null scores."""

from __future__ import annotations

from typing import Any

import polars as pl

COLUMNS = [
    "game_id", "season", "week", "game_type", "gameday", "gametime", "home_team", "away_team",
    "home_score", "away_score", "stadium", "spread_line", "total_line",
]  # fmt: skip


def build(schedule: pl.DataFrame) -> pl.DataFrame:
    return (
        schedule.with_columns(
            pl.col(["season", "week", "home_score", "away_score"]).cast(pl.Int32),
            pl.col(["spread_line", "total_line"]).cast(pl.Float64),
        )
        .sort("season", "week", "gameday", "gametime", "game_id", nulls_last=True)
        .select(COLUMNS)
    )


def to_records(df: pl.DataFrame) -> list[dict[str, Any]]:
    return df.to_dicts()


def current_week(schedule: pl.DataFrame, season: int) -> int:
    """The upcoming week: the smallest week of ``season`` with an unplayed game, else the last."""
    games = schedule.filter(pl.col("season") == season)
    unplayed = games.filter(pl.col("home_score").is_null())
    if unplayed.height:
        return int(unplayed["week"].min())  # type: ignore[arg-type]
    return int(games["week"].max())  # type: ignore[arg-type]


def stats_as_of(schedule: pl.DataFrame) -> str | None:
    played = schedule.filter(pl.col("home_score").is_not_null())
    return None if played.is_empty() else str(played["gameday"].max())
