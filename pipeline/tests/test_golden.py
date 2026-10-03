"""Golden numbers: team-season values recomputed independently from raw nflverse pbp.

The reference implementation below deliberately avoids pipeline code: it walks raw rows and
applies docs/CONTEXT.md literally.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import polars as pl
import pytest

pytestmark = pytest.mark.network

TOL = 0.005
GOLDEN_TEAM_SEASONS = [(2021, "TB"), (2021, "HOU"), (2024, "BAL"), (2024, "DET"), (2024, "CLE")]


def _is_play(r: dict[str, Any]) -> bool:
    return (
        r["season_type"] == "REG"
        and r["play_type"] in ("run", "pass")
        and r["down"] is not None
        and r["epa"] is not None
    )


def reference(pbp: pl.DataFrame, team: str) -> dict[str, float]:
    rows = [r for r in pbp.iter_rows(named=True) if _is_play(r) and r["posteam"] == team]
    drops = [r for r in rows if r["qb_dropback"] == 1]
    third = [r for r in rows if r["down"] == 3]
    return {
        "off_plays": len(rows),
        "off_epa_per_play": sum(r["epa"] for r in rows) / len(rows),
        "off_success_rate": sum(1 for r in rows if r["epa"] > 0) / len(rows),
        "off_pass_rate": len(drops) / len(rows),
        "off_pass_epa": sum(r["epa"] for r in drops) / len(drops),
        "off_third_down_conv_rate": sum(
            1 for r in third
            if r["first_down"] == 1 or (r["touchdown"] == 1 and r["td_team"] == team)
        ) / len(third),
    }  # fmt: skip


@pytest.mark.parametrize(("season", "team"), GOLDEN_TEAM_SEASONS)
def test_team_season_matches_reference(
    season: int,
    team: str,
    raw_pbp: Callable[[int], pl.DataFrame],
    tables: dict[str, pl.DataFrame],
) -> None:
    ref = reference(raw_pbp(season), team)
    row = tables["team_season"].filter((pl.col("season") == season) & (pl.col("team") == team))
    assert row.height == 1
    got = row.row(0, named=True)
    assert got["off_plays"] == ref["off_plays"]
    for metric in ("off_epa_per_play", "off_success_rate", "off_pass_rate", "off_pass_epa",
                   "off_third_down_conv_rate"):  # fmt: skip
        assert got[metric] == pytest.approx(ref[metric], abs=TOL), metric


def test_known_published_values(
    tables: dict[str, pl.DataFrame], require_season: Callable[[int], None]
) -> None:
    """Sanity anchors: well-known 2024 offenses were elite by EPA/play; league mean is near 0."""
    require_season(2024)
    ts = tables["team_season"].filter(pl.col("season") == 2024)
    top5 = ts.filter(pl.col("rank_off_epa_per_play") <= 5)["team"].to_list()
    assert "BAL" in top5 and "DET" in top5
    nfl = ts.filter(pl.col("team") == "NFL").row(0, named=True)
    assert -0.05 < nfl["off_epa_per_play"] < 0.1
    assert 0.40 < nfl["off_success_rate"] < 0.50


@pytest.mark.parametrize("season", [2021, 2024])
def test_play_filters(
    season: int, raw_pbp: Callable[[int], pl.DataFrame], tables: dict[str, pl.DataFrame]
) -> None:
    pbp = raw_pbp(season).filter(pl.col("season_type") == "REG")
    ts = tables["team_season"].filter(pl.col("season") == season)
    nfl_plays = ts.filter(pl.col("team") == "NFL")["off_plays"].item()
    expected = pbp.filter(
        pl.col("play_type").is_in(["run", "pass"])
        & pl.col("down").is_not_null()
        & pl.col("epa").is_not_null()
    ).height
    assert nfl_plays == expected
    # Kneels, spikes, no-plays and special teams are excluded, so the count is strictly below.
    excluded = pbp.filter(pl.col("play_type").is_in(["qb_kneel", "qb_spike", "no_play", "punt"]))
    assert excluded.height > 0
    assert nfl_plays + excluded.height <= pbp.filter(pl.col("play_type").is_not_null()).height
    # Scrambles are dropbacks: league pass rate uses qb_dropback, not play_type.
    plays = pbp.filter(
        pl.col("play_type").is_in(["run", "pass"]) & pl.col("down").is_not_null()
        & pl.col("epa").is_not_null()
    )  # fmt: skip
    scrambles = plays.filter((pl.col("play_type") == "run") & (pl.col("qb_dropback") == 1)).height
    assert scrambles > 0
    expected_rate = plays.filter(pl.col("qb_dropback") == 1).height / plays.height
    assert ts.filter(pl.col("team") == "NFL")["off_pass_rate"].item() == pytest.approx(
        expected_rate
    )
    # Every team's plays add up to the league total, on both sides.
    teams = ts.filter(pl.col("team") != "NFL")
    assert teams["off_plays"].sum() == nfl_plays == teams["def_plays"].sum()


def test_tendencies_consistent_with_team_season(tables: dict[str, pl.DataFrame]) -> None:
    ts = tables["team_season"]
    tt = tables["team_tendencies"]
    overall = tt.filter((pl.col("grouping") == "overall") & (pl.col("side") == "off"))
    joined = overall.join(ts, on=["season", "team"])
    assert joined.height == ts.height
    assert (joined["plays"] == joined["off_plays"]).all()
    assert ((joined["epa_per_play"] - joined["off_epa_per_play"]).abs() < 1e-9).all()
    # Each grouping partitions the same plays.
    sums = tt.group_by("season", "team", "side", "grouping").agg(pl.col("plays").sum())
    per_key = sums.group_by("season", "team", "side").agg(pl.col("plays").n_unique().alias("n"))
    assert (per_key["n"] == 1).all()
