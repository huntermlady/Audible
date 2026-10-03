"""Every bucket boundary from docs/CONTEXT.md, for the scalar and the polars implementations."""

from __future__ import annotations

import polars as pl
import pytest

from audible_pipeline import buckets


@pytest.mark.parametrize(
    ("ydstogo", "expected"),
    [(1, "short"), (3, "short"), (4, "medium"), (6, "medium"), (7, "long"), (10, "long"),
     (11, "very_long"), (25, "very_long")],
)  # fmt: skip
def test_dist_bucket(ydstogo: int, expected: str) -> None:
    assert buckets.dist_bucket(ydstogo) == expected
    got = pl.select(buckets.dist_bucket_expr(pl.lit(ydstogo))).item()
    assert got == expected


@pytest.mark.parametrize(
    ("yardline_100", "expected"),
    [(1, "red_zone"), (20, "red_zone"), (21, "opp_territory"), (49, "opp_territory"),
     (50, "own_territory"), (89, "own_territory"), (90, "backed_up"), (99, "backed_up")],
)  # fmt: skip
def test_field_zone(yardline_100: int, expected: str) -> None:
    assert buckets.field_zone(yardline_100) == expected
    assert pl.select(buckets.field_zone_expr(pl.lit(yardline_100))).item() == expected


@pytest.mark.parametrize(
    ("diff", "expected"),
    [(-20, "trail_9plus"), (-9, "trail_9plus"), (-8, "trail_1_8"), (-1, "trail_1_8"),
     (0, "tied"), (1, "lead_1_8"), (8, "lead_1_8"), (9, "lead_9plus"), (30, "lead_9plus")],
)  # fmt: skip
def test_score_state(diff: int, expected: str) -> None:
    assert buckets.score_state(diff) == expected
    assert pl.select(buckets.score_state_expr(pl.lit(diff))).item() == expected


@pytest.mark.parametrize(
    ("qtr", "secs", "expected"),
    [
        (2, 120, "two_minute"), (2, 121, "normal"), (2, 0, "two_minute"),
        (4, 120, "two_minute"), (4, 121, "fourth_quarter"), (4, 900, "fourth_quarter"),
        (1, 120, "normal"), (1, 60, "normal"), (3, 120, "normal"), (3, 30, "normal"),
        (5, 60, "fourth_quarter"), (5, 600, "fourth_quarter"),
    ],
)  # fmt: skip
def test_time_bucket(qtr: int, secs: int, expected: str) -> None:
    assert buckets.time_bucket(qtr, secs) == expected
    got = pl.select(buckets.time_bucket_expr(pl.lit(qtr), pl.lit(secs))).item()
    assert got == expected


def test_exprs_match_scalars_on_full_domain() -> None:
    df = pl.DataFrame({"v": list(range(-40, 100))})
    for scalar, expr, domain in [
        (buckets.dist_bucket, buckets.dist_bucket_expr, range(1, 40)),
        (buckets.field_zone, buckets.field_zone_expr, range(1, 100)),
        (buckets.score_state, buckets.score_state_expr, range(-40, 41)),
    ]:
        sub = df.filter(pl.col("v").is_in(list(domain)))
        got = sub.select(expr(pl.col("v"))).to_series().to_list()
        assert got == [scalar(v) for v in sub["v"]]
    grid = pl.DataFrame(
        [(q, s) for q in range(1, 6) for s in range(0, 901, 15)], schema=["q", "s"], orient="row"
    )
    got = grid.select(buckets.time_bucket_expr(pl.col("q"), pl.col("s"))).to_series().to_list()
    assert got == [buckets.time_bucket(q, s) for q, s in grid.iter_rows()]
