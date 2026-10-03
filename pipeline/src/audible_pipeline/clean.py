"""Turn raw nflverse frames into one tidy ``plays`` frame (docs/CONTEXT.md "Play").

A play is a pbp row of a final game with ``play_type in {run, pass}`` and a down (drops 2-pt
tries), non-null EPA, and both teams known. ``qb_kneel``/``qb_spike`` and ``no_play`` have their
own ``play_type`` values, so they drop out. ``is_pass`` is ``qb_dropback == 1``, which counts
scrambles and sacks as pass plays.

Optional charting fields are attached to dropbacks only and stay null when unmatched.
"""

from __future__ import annotations

import polars as pl

from audible_pipeline import buckets

PBP_COLUMNS = [
    "game_id", "play_id", "season", "season_type", "week", "posteam", "defteam", "home_team",
    "play_type", "down", "ydstogo", "yardline_100", "qtr", "quarter_seconds_remaining",
    "score_differential", "epa", "qb_dropback", "xpass", "yards_gained", "air_yards",
    "pass_attempt", "complete_pass", "sack", "shotgun", "no_huddle", "pass_location",
    "run_location", "first_down", "touchdown", "td_team", "interception", "cpoe",
    "passer_id", "rusher_player_id", "receiver_player_id", "qb_scramble", "fixed_drive",
    "fixed_drive_result",
]  # fmt: skip

EXPLOSIVE_RUN_YARDS = 10
EXPLOSIVE_PASS_YARDS = 20
DEEP_PASS_AIR_YARDS = 20
BLITZ_MIN_RUSHERS = 5


def final_game_ids(schedule: pl.DataFrame) -> pl.Series:
    return schedule.filter(pl.col("home_score").is_not_null())["game_id"]


def build_plays(
    pbp: pl.DataFrame,
    final_games: pl.Series,
    ftn: pl.DataFrame | None = None,
    participation: pl.DataFrame | None = None,
) -> pl.DataFrame:
    plays = (
        pbp.select(PBP_COLUMNS)
        .filter(
            pl.col("game_id").is_in(final_games.implode())
            & pl.col("play_type").is_in(["run", "pass"])
            & pl.col("down").is_not_null()
            & pl.col("epa").is_not_null()
            & pl.col("posteam").is_not_null()
            & pl.col("defteam").is_not_null()
        )
        .with_columns(
            pl.col("play_id").cast(pl.Int64),
            pl.col(["season", "week", "down", "ydstogo", "yardline_100", "qtr"]).cast(pl.Int32),
            pl.col("quarter_seconds_remaining").cast(pl.Int32),
            pl.col("score_differential").cast(pl.Int32),
            (pl.col("qb_dropback") == 1).alias("is_pass"),
            (pl.col("epa") > 0).alias("success"),
        )
        .with_columns(
            pl.when(pl.col("is_pass"))
            .then(pl.col("yards_gained") >= EXPLOSIVE_PASS_YARDS)
            .otherwise(pl.col("yards_gained") >= EXPLOSIVE_RUN_YARDS)
            .fill_null(False)
            .alias("explosive"),
            # Designed runs only: scrambles are dropbacks and carry no run_location intent.
            (~pl.col("is_pass")).alias("is_run"),
            (pl.col("is_pass") & (pl.col("pass_attempt") == 1) & (pl.col("sack") != 1)).alias(
                "is_pass_attempt"
            ),
            (
                (pl.col("first_down") == 1)
                | ((pl.col("touchdown") == 1) & (pl.col("td_team") == pl.col("posteam")))
            ).alias("converted"),
            buckets.dist_bucket_expr(pl.col("ydstogo")).alias("dist_bucket"),
            buckets.field_zone_expr(pl.col("yardline_100")).alias("field_zone"),
            buckets.score_state_expr(pl.col("score_differential")).alias("score_state"),
            buckets.time_bucket_expr(pl.col("qtr"), pl.col("quarter_seconds_remaining")).alias(
                "time_bucket"
            ),
        )
    )
    return _attach_charting(plays, ftn, participation)


def _attach_charting(
    plays: pl.DataFrame, ftn: pl.DataFrame | None, participation: pl.DataFrame | None
) -> pl.DataFrame:
    if ftn is not None:
        ftn_cols = ftn.select(
            pl.col("nflverse_game_id").alias("game_id"),
            pl.col("nflverse_play_id").cast(pl.Int64).alias("play_id"),
            pl.col("n_pass_rushers").alias("ftn_rushers"),
            pl.col("is_play_action").alias("ftn_play_action"),
            pl.col("is_screen_pass").alias("ftn_screen"),
        ).unique(["game_id", "play_id"], keep="first")
        plays = plays.join(ftn_cols, on=["game_id", "play_id"], how="left")
    else:
        plays = plays.with_columns(
            pl.lit(None, pl.Int32).alias("ftn_rushers"),
            pl.lit(None, pl.Boolean).alias("ftn_play_action"),
            pl.lit(None, pl.Boolean).alias("ftn_screen"),
        )
    if participation is not None:
        part_cols = participation.select(
            pl.col("nflverse_game_id").alias("game_id"),
            pl.col("play_id").cast(pl.Int64),
            pl.col("number_of_pass_rushers").alias("part_rushers"),
            pl.col("was_pressure").alias("part_pressure"),
            pl.col("defense_man_zone_type").alias("part_man_zone"),
        ).unique(["game_id", "play_id"], keep="first")
        plays = plays.join(part_cols, on=["game_id", "play_id"], how="left")
    else:
        plays = plays.with_columns(
            pl.lit(None, pl.Int32).alias("part_rushers"),
            pl.lit(None, pl.Boolean).alias("part_pressure"),
            pl.lit(None, pl.String).alias("part_man_zone"),
        )

    # 0 rushers means "not charted", not "no rush".
    rushers = pl.coalesce(
        pl.when(pl.col("ftn_rushers") > 0).then(pl.col("ftn_rushers")),
        pl.when(pl.col("part_rushers") > 0).then(pl.col("part_rushers")),
    )
    on_dropback = pl.col("is_pass")
    return plays.with_columns(
        pl.when(on_dropback).then(rushers >= BLITZ_MIN_RUSHERS).alias("blitz"),
        pl.when(on_dropback).then(pl.col("part_pressure")).alias("pressure"),
        pl.when(on_dropback)
        .then(
            pl.when(pl.col("part_man_zone") == "MAN_COVERAGE")
            .then(pl.lit("man"))
            .when(pl.col("part_man_zone") == "ZONE_COVERAGE")
            .then(pl.lit("zone"))
        )
        .alias("man_zone"),
        pl.when(on_dropback).then(pl.col("ftn_play_action")).alias("play_action"),
        pl.when(on_dropback).then(pl.col("ftn_screen")).alias("screen"),
    ).drop(
        "ftn_rushers", "ftn_play_action", "ftn_screen",
        "part_rushers", "part_pressure", "part_man_zone",
    )  # fmt: skip


SCRIMMAGE_PLAY_TYPES = ["run", "pass", "field_goal", "punt", "qb_kneel", "qb_spike", "no_play"]


def build_drives(pbp: pl.DataFrame, final_games: pl.Series) -> pl.DataFrame:
    """One row per offensive drive: whether it snapped at ``yardline_100 <= 20`` and scored a TD."""
    return (
        pbp.filter(
            pl.col("game_id").is_in(final_games.implode())
            & pl.col("play_type").is_in(SCRIMMAGE_PLAY_TYPES)
            & pl.col("posteam").is_not_null()
            & pl.col("defteam").is_not_null()
            & pl.col("fixed_drive").is_not_null()
        )
        .group_by("season", "season_type", "week", "game_id", "posteam", "defteam", "fixed_drive")
        .agg(
            (pl.col("yardline_100") <= 20).any().alias("reached_red_zone"),
            (pl.col("fixed_drive_result").first() == "Touchdown").alias("touchdown"),
        )
        .with_columns(pl.col(["season", "week"]).cast(pl.Int32))
    )
