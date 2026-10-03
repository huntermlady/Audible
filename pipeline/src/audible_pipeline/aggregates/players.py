"""player_season: one row per player per regular season per team (plan §5.2.5).

Counting stats come from nflverse weekly player stats summed by team, so traded players get one
row per team. EPA/success/CPOE come from the cleaned plays so they share the team definitions.
A whole block (passing/rushing/receiving) is null when the player has no volume in it; any rate
is null when its denominator is 0.
"""

from __future__ import annotations

import polars as pl

POSITIONS = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}

PASSING = [
    "pass_att", "completions", "pass_yds", "pass_td", "interceptions", "sacks",
    "epa_per_dropback", "cpoe", "any_a",
]  # fmt: skip
RUSHING = ["rush_att", "rush_yds", "rush_td", "epa_per_rush", "rush_success_rate"]
RECEIVING = [
    "targets", "receptions", "rec_yds", "rec_td", "epa_per_target", "target_share",
    "air_yards_share", "yac_per_rec",
]  # fmt: skip
COLUMNS = ["season", "player_id", "player_name", "team", "position", "games",
           *PASSING, *RUSHING, *RECEIVING]  # fmt: skip
INT_COLUMNS = {
    "games", "pass_att", "completions", "pass_yds", "pass_td", "interceptions", "sacks",
    "rush_att", "rush_yds", "rush_td", "targets", "receptions", "rec_yds", "rec_td",
}  # fmt: skip


def _ratio(num: pl.Expr, den: pl.Expr) -> pl.Expr:
    return pl.when(den > 0).then(num / den)


def build(weekly: pl.DataFrame, plays: pl.DataFrame) -> pl.DataFrame:
    """``weekly`` and ``plays`` must be REG-season only (plays with coverage applied)."""
    weekly = weekly.filter(pl.col("player_id").is_not_null() & pl.col("team").is_not_null())
    team_games = weekly.group_by("season", "week", "team").agg(
        pl.col("targets").sum().alias("team_targets"),
        pl.col("receiving_air_yards").sum().alias("team_air_yards"),
    )
    w = weekly.join(team_games, on=["season", "week", "team"], how="left")
    counts = (
        w.sort("week")
        .group_by("season", "player_id", "team")
        .agg(
            pl.col("player_display_name").last().alias("player_name"),
            pl.col("position").last().alias("raw_position"),
            pl.len().alias("games"),
            pl.col("attempts").sum().alias("pass_att"),
            pl.col("completions").sum(),
            pl.col("passing_yards").sum().alias("pass_yds"),
            pl.col("passing_tds").sum().alias("pass_td"),
            pl.col("passing_interceptions").sum().alias("interceptions"),
            pl.col("sacks_suffered").sum().alias("sacks"),
            pl.col("sack_yards_lost").abs().sum().alias("sack_yds"),
            pl.col("carries").sum().alias("rush_att"),
            pl.col("rushing_yards").sum().alias("rush_yds"),
            pl.col("rushing_tds").sum().alias("rush_td"),
            pl.col("targets").sum(),
            pl.col("receptions").sum(),
            pl.col("receiving_yards").sum().alias("rec_yds"),
            pl.col("receiving_tds").sum().alias("rec_td"),
            pl.col("receiving_air_yards").sum().alias("air_yds"),
            pl.col("receiving_yards_after_catch").sum().alias("yac"),
            pl.col("team_targets").sum(),
            pl.col("team_air_yards").sum(),
        )
        .with_columns(
            pl.col("raw_position").replace_strict(POSITIONS, default=None).alias("position")
        )
        .filter(pl.col("position").is_not_null())
    )

    passer = (
        plays.filter(pl.col("is_pass") & pl.col("passer_id").is_not_null())
        .group_by("season", pl.col("passer_id").alias("player_id"), pl.col("posteam").alias("team"))
        .agg(
            pl.col("epa").mean().alias("epa_per_dropback"),
            pl.col("cpoe").filter(pl.col("is_pass_attempt")).mean().alias("cpoe"),
        )
    )
    rusher = (
        plays.filter(pl.col("is_run") & pl.col("rusher_player_id").is_not_null())
        .group_by(
            "season", pl.col("rusher_player_id").alias("player_id"), pl.col("posteam").alias("team")
        )
        .agg(
            pl.col("epa").mean().alias("epa_per_rush"),
            pl.col("success").cast(pl.Float64).mean().alias("rush_success_rate"),
        )
    )
    receiver = (
        plays.filter(pl.col("receiver_player_id").is_not_null())
        .group_by(
            "season",
            pl.col("receiver_player_id").alias("player_id"),
            pl.col("posteam").alias("team"),
        )
        .agg(pl.col("epa").mean().alias("epa_per_target"))
    )
    keys = ["season", "player_id", "team"]
    df = (
        counts.join(passer, on=keys, how="left")
        .join(rusher, on=keys, how="left")
        .join(receiver, on=keys, how="left")
        .with_columns(
            _ratio(
                pl.col("pass_yds")
                + 20 * pl.col("pass_td")
                - 45 * pl.col("interceptions")
                - pl.col("sack_yds"),
                pl.col("pass_att") + pl.col("sacks"),
            ).alias("any_a"),
            _ratio(pl.col("targets"), pl.col("team_targets")).alias("target_share"),
            _ratio(pl.col("air_yds"), pl.col("team_air_yards")).alias("air_yards_share"),
            _ratio(pl.col("yac"), pl.col("receptions")).alias("yac_per_rec"),
        )
    )
    has_pass = (pl.col("pass_att") + pl.col("sacks")) > 0
    has_rush = pl.col("rush_att") > 0
    has_rec = pl.col("targets") > 0
    df = df.filter(has_pass | has_rush | has_rec).with_columns(
        *(pl.when(has_pass).then(pl.col(c)).alias(c) for c in PASSING),
        *(pl.when(has_rush).then(pl.col(c)).alias(c) for c in RUSHING),
        *(pl.when(has_rec).then(pl.col(c)).alias(c) for c in RECEIVING),
    )
    return (
        df.with_columns(
            pl.col(sorted(INT_COLUMNS)).cast(pl.Int32),
            pl.col("season").cast(pl.Int32),
            pl.col(
                [
                    c
                    for c in COLUMNS
                    if c not in INT_COLUMNS
                    and c not in {"season", "player_id", "player_name", "team", "position"}
                ]
            ).cast(pl.Float64),
        )
        .sort("season", "team", "position", "player_id")
        .select(COLUMNS)
    )
