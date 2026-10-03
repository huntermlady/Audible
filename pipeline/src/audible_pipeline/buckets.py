"""Situation buckets, exactly as defined in docs/CONTEXT.md.

Every bucket describes the play from the offense's perspective, including ``side = def`` rows.
Scalar functions are the reference; the polars expressions are what the pipeline uses, and the
tests check that both agree at every boundary.
"""

from __future__ import annotations

from typing import Literal

import polars as pl

DistBucket = Literal["short", "medium", "long", "very_long"]
FieldZone = Literal["backed_up", "own_territory", "opp_territory", "red_zone"]
ScoreState = Literal["trail_9plus", "trail_1_8", "tied", "lead_1_8", "lead_9plus"]
TimeBucket = Literal["two_minute", "fourth_quarter", "normal"]

DOWNS = (1, 2, 3, 4)
DIST_BUCKETS: tuple[DistBucket, ...] = ("short", "medium", "long", "very_long")
FIELD_ZONES: tuple[FieldZone, ...] = ("backed_up", "own_territory", "opp_territory", "red_zone")
SCORE_STATES: tuple[ScoreState, ...] = (
    "trail_9plus",
    "trail_1_8",
    "tied",
    "lead_1_8",
    "lead_9plus",
)
TIME_BUCKETS: tuple[TimeBucket, ...] = ("two_minute", "fourth_quarter", "normal")

TWO_MINUTE_SECONDS = 120


def dist_bucket(ydstogo: int) -> DistBucket:
    """short 1-3, medium 4-6, long 7-10, very_long 11+."""
    if ydstogo <= 3:
        return "short"
    if ydstogo <= 6:
        return "medium"
    if ydstogo <= 10:
        return "long"
    return "very_long"


def field_zone(yardline_100: int) -> FieldZone:
    """red_zone 1-20, opp_territory 21-49, own_territory 50-89, backed_up 90-99."""
    if yardline_100 <= 20:
        return "red_zone"
    if yardline_100 <= 49:
        return "opp_territory"
    if yardline_100 <= 89:
        return "own_territory"
    return "backed_up"


def score_state(score_diff: int) -> ScoreState:
    """Score difference from the offense's perspective."""
    if score_diff <= -9:
        return "trail_9plus"
    if score_diff <= -1:
        return "trail_1_8"
    if score_diff == 0:
        return "tied"
    if score_diff <= 8:
        return "lead_1_8"
    return "lead_9plus"


def time_bucket(qtr: int, quarter_seconds_remaining: int) -> TimeBucket:
    """two_minute: <= 120 s left in Q2 or Q4; fourth_quarter: rest of Q4 and OT; else normal."""
    if qtr in (2, 4) and quarter_seconds_remaining <= TWO_MINUTE_SECONDS:
        return "two_minute"
    if qtr >= 4:
        return "fourth_quarter"
    return "normal"


def dist_bucket_expr(ydstogo: pl.Expr) -> pl.Expr:
    return (
        pl.when(ydstogo <= 3)
        .then(pl.lit("short"))
        .when(ydstogo <= 6)
        .then(pl.lit("medium"))
        .when(ydstogo <= 10)
        .then(pl.lit("long"))
        .otherwise(pl.lit("very_long"))
    )


def field_zone_expr(yardline_100: pl.Expr) -> pl.Expr:
    return (
        pl.when(yardline_100 <= 20)
        .then(pl.lit("red_zone"))
        .when(yardline_100 <= 49)
        .then(pl.lit("opp_territory"))
        .when(yardline_100 <= 89)
        .then(pl.lit("own_territory"))
        .otherwise(pl.lit("backed_up"))
    )


def score_state_expr(score_diff: pl.Expr) -> pl.Expr:
    return (
        pl.when(score_diff <= -9)
        .then(pl.lit("trail_9plus"))
        .when(score_diff <= -1)
        .then(pl.lit("trail_1_8"))
        .when(score_diff == 0)
        .then(pl.lit("tied"))
        .when(score_diff <= 8)
        .then(pl.lit("lead_1_8"))
        .otherwise(pl.lit("lead_9plus"))
    )


def time_bucket_expr(qtr: pl.Expr, quarter_seconds_remaining: pl.Expr) -> pl.Expr:
    return (
        pl.when(qtr.is_in([2, 4]) & (quarter_seconds_remaining <= TWO_MINUTE_SECONDS))
        .then(pl.lit("two_minute"))
        .when(qtr >= 4)
        .then(pl.lit("fourth_quarter"))
        .otherwise(pl.lit("normal"))
    )
