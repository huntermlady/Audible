"""team_tendencies: DuckDB GROUPING SETS over the six fixed groupings (plan §5.2.4).

Rows exist for each team's offense (``off``) and defense (``def``, what it allowed/did) plus the
league baseline ``team = "NFL"``, which is ``off`` only (league offense == league defense allowed).
"""

from __future__ import annotations

import duckdb
import polars as pl

from audible_pipeline.aggregates.metrics import TENDENCY_METRICS, select_list

DIMENSIONS = ("down", "dist_bucket", "field_zone", "score_state", "time_bucket")

GROUPINGS: dict[str, tuple[str, ...]] = {
    "overall": (),
    "down_dist": ("down", "dist_bucket"),
    "down_dist_zone": ("down", "dist_bucket", "field_zone"),
    "zone": ("field_zone",),
    "score_time": ("score_state", "time_bucket"),
    "down_dist_score_time": ("down", "dist_bucket", "score_state", "time_bucket"),
}

KEY_COLUMNS = ["season", "team", "side", "grouping", *DIMENSIONS, "cell_key"]
COLUMNS = [*KEY_COLUMNS, *TENDENCY_METRICS]


def _grouping_mask(dims: tuple[str, ...]) -> int:
    """DuckDB GROUPING(): bit set (MSB = first arg) for each dimension NOT grouped."""
    mask = 0
    for dim in DIMENSIONS:
        mask = (mask << 1) | (0 if dim in dims else 1)
    return mask


def cell_key_expr() -> pl.Expr:
    d = pl.format("d{}", pl.col("down"))
    return (
        pl.when(pl.col("grouping") == "overall")
        .then(pl.lit("all"))
        .when(pl.col("grouping") == "down_dist")
        .then(pl.concat_str([d, pl.col("dist_bucket")], separator="-"))
        .when(pl.col("grouping") == "down_dist_zone")
        .then(pl.concat_str([d, pl.col("dist_bucket"), pl.col("field_zone")], separator="-"))
        .when(pl.col("grouping") == "zone")
        .then(pl.col("field_zone"))
        .when(pl.col("grouping") == "score_time")
        .then(pl.concat_str([pl.col("score_state"), pl.col("time_bucket")], separator="-"))
        .otherwise(
            pl.concat_str(
                [d, pl.col("dist_bucket"), pl.col("score_state"), pl.col("time_bucket")],
                separator="-",
            )
        )
    )


def build(plays: pl.DataFrame) -> pl.DataFrame:
    """``plays`` must already be REG-season only with coverage applied."""
    con = duckdb.connect()
    con.register("plays", plays.to_arrow())
    sets = ",\n    ".join(
        "(" + ", ".join(["season", "team", "side", *dims]) + ")" for dims in GROUPINGS.values()
    )
    mask_to_grouping = {_grouping_mask(dims): name for name, dims in GROUPINGS.items()}
    case = " ".join(f"WHEN {m} THEN '{name}'" for m, name in mask_to_grouping.items())
    sql = f"""
    WITH sided AS (
      SELECT *, posteam AS team, 'off' AS side FROM plays
      UNION ALL SELECT *, defteam AS team, 'def' AS side FROM plays
      UNION ALL SELECT *, 'NFL' AS team, 'off' AS side FROM plays
    )
    SELECT
      season::INTEGER AS season, team, side,
      CASE GROUPING({", ".join(DIMENSIONS)}) {case} END AS grouping,
      down::INTEGER AS down, dist_bucket, field_zone, score_state, time_bucket,
      {select_list(TENDENCY_METRICS)}
    FROM sided
    GROUP BY GROUPING SETS (
    {sets}
    )
    """
    df = con.sql(sql).pl()
    con.close()
    grouping_order = {name: i for i, name in enumerate(GROUPINGS)}
    return (
        df.with_columns(cell_key_expr().alias("cell_key"))
        .with_columns(pl.col("grouping").replace_strict(grouping_order).alias("_g"))
        .sort("season", "team", "side", "_g", "cell_key")
        .select(COLUMNS)
    )
