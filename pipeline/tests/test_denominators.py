"""Tendency rate denominators per docs/CONTEXT.md, on a hand-built cell of five plays."""

from __future__ import annotations

import polars as pl
import pytest

from audible_pipeline.aggregates import tendencies

# run(left) | run(no location) | pass attempt(left, 25 air yds) | sack | scramble
PLAYS = pl.DataFrame(
    {
        "season": [2024] * 5,
        "posteam": ["KC"] * 5,
        "defteam": ["BAL"] * 5,
        "down": [1] * 5,
        "dist_bucket": ["long"] * 5,
        "field_zone": ["own_territory"] * 5,
        "score_state": ["tied"] * 5,
        "time_bucket": ["normal"] * 5,
        "epa": [1.0, -1.0, 2.0, -2.0, 0.5],
        "success": [True, False, True, False, True],
        "explosive": [False, False, True, False, False],
        "is_pass": [False, False, True, True, True],
        "is_pass_attempt": [False, False, True, False, False],
        "xpass": [0.4, None, 0.6, 0.6, 0.6],
        "air_yards": [None, None, 25.0, None, None],
        "pass_location": [None, None, "left", None, None],
        "run_location": ["left", None, None, None, None],
        "sack": [0.0, 0.0, 0.0, 1.0, 0.0],
        "shotgun": [0.0, 0.0, 1.0, 1.0, 1.0],
        "no_huddle": [0.0, 0.0, 0.0, 0.0, 1.0],
        "screen": [None, None, True, False, None],  # uncharted scramble
        "play_action": [None, None, False, False, False],
        "blitz": [None, None, True, True, False],
        "pressure": [None, None, False, True, None],
        "man_zone": [None, None, "man", "zone", "zone"],
    },
    schema_overrides={"screen": pl.Boolean, "pressure": pl.Boolean},
)


@pytest.fixture(scope="module")
def cell() -> dict[str, object]:
    df = tendencies.build(PLAYS)
    row = df.filter(
        (pl.col("team") == "KC") & (pl.col("side") == "off") & (pl.col("grouping") == "overall")
    )
    return row.row(0, named=True)


EXPECTED = {
    # per play
    "plays": 5,
    "pass_rate": 3 / 5,
    "proe": ((0 - 0.4) + (1 - 0.6) * 3) / 4,  # plays with xpass
    "epa_per_play": 0.5 / 5,
    "success_rate": 3 / 5,
    "explosive_rate": 1 / 5,
    "shotgun_rate": 3 / 5,
    "no_huddle_rate": 1 / 5,
    # per dropback (charting rates: over charted dropbacks)
    "pass_epa": 0.5 / 3,
    "pass_success_rate": 2 / 3,
    "sack_rate": 1 / 3,
    "screen_rate": 1 / 2,
    "play_action_rate": 0.0,
    "blitz_rate": 2 / 3,
    "pressure_rate": 1 / 2,
    "man_rate": 1 / 3,
    "zone_rate": 2 / 3,
    # per pass attempt (sacks and scrambles excluded)
    "avg_air_yards": 25.0,
    "deep_pass_rate": 1.0,
    "pass_left_rate": 1.0,
    "pass_middle_rate": 0.0,
    "pass_right_rate": 0.0,
    # per designed run (direction: runs with a recorded run_location)
    "run_epa": 0.0,
    "run_success_rate": 1 / 2,
    "run_left_rate": 1.0,
    "run_middle_rate": 0.0,
    "run_right_rate": 0.0,
}


@pytest.mark.parametrize("metric", list(EXPECTED))
def test_denominator(cell: dict[str, object], metric: str) -> None:
    assert cell[metric] == pytest.approx(EXPECTED[metric]), metric


def test_empty_denominator_is_null() -> None:
    only_runs = PLAYS.filter(~pl.col("is_pass"))
    row = tendencies.build(only_runs).filter(
        (pl.col("team") == "KC") & (pl.col("grouping") == "overall")
    )
    for metric in ("pass_epa", "sack_rate", "avg_air_yards", "pass_left_rate", "blitz_rate"):
        assert row[metric].item() is None, metric
