"""Per-season availability of optional data (charting, participation, model columns).

A source is available for a season when at least ``MIN_COVERAGE`` of its eligible plays carry a
value. Unavailable sources are nulled out on every play before aggregating, so each derived field
is null for the whole season (never 0) and the manifest lists only the seasons where it exists.
"""

from __future__ import annotations

import polars as pl

MIN_COVERAGE = 0.8

# plays column -> (eligible-play filter, output fields derived from it)
SOURCES: dict[str, tuple[pl.Expr, tuple[str, ...]]] = {
    "xpass": (pl.lit(True), ("proe", "off_proe")),
    "air_yards": (pl.col("is_pass_attempt"), ("avg_air_yards", "deep_pass_rate")),
    "screen": (pl.col("is_pass"), ("screen_rate",)),
    "play_action": (pl.col("is_pass"), ("play_action_rate",)),
    "blitz": (pl.col("is_pass"), ("blitz_rate", "def_blitz_rate")),
    "pressure": (pl.col("is_pass"), ("pressure_rate", "def_pressure_rate")),
    "man_zone": (pl.col("is_pass"), ("man_rate", "zone_rate")),
    "cpoe": (pl.col("is_pass_attempt"), ("cpoe",)),
}

OPTIONAL_FIELDS: tuple[str, ...] = tuple(f for _, fields in SOURCES.values() for f in fields)


def source_coverage(plays: pl.DataFrame) -> dict[str, float]:
    """Share of eligible plays with a non-null value, per source, for one season's plays."""
    out: dict[str, float] = {}
    for column, (eligible, _) in SOURCES.items():
        sub = plays.filter(eligible)
        present = sub.height - sub[column].null_count()
        out[column] = present / sub.height if sub.height else 0.0
    return out


def available_sources(plays: pl.DataFrame) -> set[str]:
    return {src for src, share in source_coverage(plays).items() if share >= MIN_COVERAGE}


def apply_coverage(plays: pl.DataFrame, available: set[str]) -> pl.DataFrame:
    """Null out every source that is not available for this season."""
    missing = [c for c in SOURCES if c not in available]
    return plays.with_columns(pl.lit(None, plays.schema[c]).alias(c) for c in missing)


def optional_fields_by_season(available_by_season: dict[int, set[str]]) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for source, (_, fields) in SOURCES.items():
        seasons = sorted(s for s, avail in available_by_season.items() if source in avail)
        for field in fields:
            out[field] = seasons
    return out
