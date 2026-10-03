"""Optional fields are null (never 0) where the source lacks them, and the manifest says so."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import polars as pl
import pytest

from audible_pipeline import coverage

FILE_FOR_FIELD = {
    "off_proe": "team_season", "def_blitz_rate": "team_season", "def_pressure_rate": "team_season",
    "cpoe": "player_season",
}  # fmt: skip


@pytest.mark.network
def test_manifest_lists_exactly_populated_seasons(
    tables: dict[str, pl.DataFrame], manifest: dict[str, Any]
) -> None:
    listed = manifest["optional_fields_by_season"]
    assert set(listed) == set(coverage.OPTIONAL_FIELDS)
    for field, seasons in listed.items():
        df = tables[FILE_FOR_FIELD.get(field, "team_tendencies")]
        for season in manifest["seasons"]:
            col = df.filter(pl.col("season") == season)[field]
            if season in seasons:
                assert col.drop_nulls().len() > 0, (field, season)
            else:
                assert col.null_count() == col.len(), (field, season)


@pytest.mark.network
def test_known_gaps(manifest: dict[str, Any], require_season: Callable[[int], None]) -> None:
    require_season(2021)
    require_season(2024)
    listed = manifest["optional_fields_by_season"]
    assert 2021 not in listed["play_action_rate"]  # FTN charting starts in 2022
    assert 2021 not in listed["screen_rate"]
    assert 2024 in listed["man_rate"] and 2024 in listed["pressure_rate"]
    assert 2021 in listed["blitz_rate"]  # participation rusher counts


@pytest.mark.network
def test_no_zero_fill_for_missing_sources(
    tables: dict[str, pl.DataFrame], manifest: dict[str, Any]
) -> None:
    tt = tables["team_tendencies"]
    for field, seasons in manifest["optional_fields_by_season"].items():
        if field not in tt.columns:
            continue
        missing = tt.filter(~pl.col("season").is_in(seasons))
        assert missing.filter(pl.col(field) == 0).height == 0, field


def _plays(**cols: list[Any]) -> pl.DataFrame:
    n = len(next(iter(cols.values())))
    base: dict[str, Any] = {
        "is_pass": [True] * n, "is_pass_attempt": [True] * n, "xpass": [0.5] * n,
        "air_yards": [5.0] * n, "screen": [False] * n, "play_action": [False] * n,
        "blitz": [False] * n, "pressure": [False] * n, "man_zone": ["man"] * n, "cpoe": [1.0] * n,
    }  # fmt: skip
    base.update(cols)
    return pl.DataFrame(base, schema_overrides={"screen": pl.Boolean, "pressure": pl.Boolean})


def test_threshold_and_nulling() -> None:
    plays = _plays(pressure=[True, None, None, None, None], screen=[True, False, True, False, None])
    avail = coverage.available_sources(plays)
    assert "pressure" not in avail  # 20% coverage
    assert "screen" in avail  # 80% coverage
    applied = coverage.apply_coverage(plays, avail)
    assert applied["pressure"].null_count() == applied.height
    assert applied["screen"].to_list() == plays["screen"].to_list()
    assert applied.schema == plays.schema


def test_optional_fields_by_season() -> None:
    out = coverage.optional_fields_by_season({2021: {"xpass"}, 2022: {"xpass", "man_zone"}})
    assert out["proe"] == [2021, 2022]
    assert out["man_rate"] == out["zone_rate"] == [2022]
    assert out["pressure_rate"] == []
