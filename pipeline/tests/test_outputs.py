"""Every output file matches its shared/schemas contract, row by row and column by column."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import BaseModel

from audible_contracts import models
from audible_contracts.paths import SCHEMAS_DIR

pytestmark = pytest.mark.network

PARQUET: dict[str, tuple[str, type[BaseModel]]] = {
    "team_season": ("team_season_row", models.TeamSeasonRow),
    "team_week": ("team_week_row", models.TeamWeekRow),
    "team_tendencies": ("team_tendency_row", models.TeamTendencyRow),
    "player_season": ("player_season_row", models.PlayerSeasonRow),
}
ARROW_TYPES = {"integer": pa.int32(), "number": pa.float64(), "boolean": pa.bool_(),
               "string": pa.string()}  # fmt: skip


def schema(name: str) -> dict[str, Any]:
    return json.loads((SCHEMAS_DIR / f"{name}.schema.json").read_text())


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(schema(name), format_checker=FormatChecker())


@pytest.mark.parametrize("name", list(PARQUET))
def test_parquet_columns_match_schema(name: str, out_dir: Path) -> None:
    sch = schema(PARQUET[name][0])
    arrow = pq.read_schema(out_dir / f"{name}.parquet")
    assert arrow.names == list(sch["properties"]), "column names/order"
    for col, prop in sch["properties"].items():
        types = prop["type"] if isinstance(prop["type"], list) else [prop["type"]]
        base = next(t for t in types if t != "null")
        assert arrow.field(col).type == ARROW_TYPES[base], col


@pytest.mark.parametrize("name", list(PARQUET))
def test_parquet_rows_validate(name: str, tables: dict[str, pl.DataFrame]) -> None:
    schema_name, model = PARQUET[name]
    v = validator(schema_name)
    rows = tables[name].to_dicts()
    assert rows
    for row in rows:
        errors = list(v.iter_errors(row))
        assert not errors, (row, [e.message for e in errors[:3]])
    for row in rows[:: max(1, len(rows) // 500)]:
        model.model_validate(row)


def test_schedule_validates(out_dir: Path, manifest: dict[str, Any]) -> None:
    games = json.loads((out_dir / "schedule.json").read_text())
    v = validator("schedule_game")
    for g in games:
        assert not list(v.iter_errors(g)), g
        models.ScheduleGame.model_validate(g)
    assert {g["season"] for g in games} == set(manifest["seasons"])
    future = [
        g for g in games if g["season"] == manifest["current_season"] and g["home_score"] is None
    ]
    assert future, "schedule includes unplayed games of the current season"


def test_manifest(out_dir: Path, manifest: dict[str, Any]) -> None:
    on_disk = json.loads((out_dir / "manifest.json").read_text())
    assert on_disk == manifest
    assert not list(validator("manifest").iter_errors(on_disk))
    models.Manifest.model_validate(on_disk)
    for key, entry in on_disk["files"].items():
        data = (out_dir / entry["path"]).read_bytes()
        assert entry["sha256"] == hashlib.sha256(data).hexdigest(), key
        assert entry["bytes"] == len(data), key
        if entry["path"].endswith(".parquet"):
            assert entry["rows"] == pq.read_metadata(out_dir / entry["path"]).num_rows, key
            assert (
                pq.read_metadata(out_dir / entry["path"]).row_group(0).column(0).compression
                == "ZSTD"
            )
        else:
            assert entry["rows"] == len(json.loads(data)), key


def test_current_week_is_upcoming(out_dir: Path, manifest: dict[str, Any]) -> None:
    games = json.loads((out_dir / "schedule.json").read_text())
    cur = [g for g in games if g["season"] == manifest["current_season"]]
    unplayed = [g["week"] for g in cur if g["home_score"] is None]
    expected = min(unplayed) if unplayed else max(g["week"] for g in cur)
    assert manifest["current_week"] == expected


def test_nfl_rows_everywhere(tables: dict[str, pl.DataFrame], manifest: dict[str, Any]) -> None:
    tt = tables["team_tendencies"]
    nfl = tt.filter(pl.col("team") == "NFL")
    assert set(nfl["side"].unique()) == {"off"}
    groupings = {
        "overall",
        "down_dist",
        "down_dist_zone",
        "zone",
        "score_time",
        "down_dist_score_time",
    }
    for season in manifest["seasons"]:
        got = set(nfl.filter(pl.col("season") == season)["grouping"].unique())
        assert got == groupings, season
        # Every team cell has an NFL cell with the same key.
        team_keys = set(
            tt.filter(pl.col("season") == season).select("grouping", "cell_key").iter_rows()
        )
        nfl_keys = set(
            nfl.filter(pl.col("season") == season).select("grouping", "cell_key").iter_rows()
        )
        assert team_keys == nfl_keys
    ts = tables["team_season"]
    for season in manifest["seasons"]:
        s = ts.filter(pl.col("season") == season)
        assert s.filter(pl.col("team") == "NFL").height == 1
        assert s.filter(pl.col("team") != "NFL").height == 32
    ranks = [c for c in ts.columns if c.startswith("rank_")]
    assert ts.filter(pl.col("team") == "NFL").select(ranks).null_count().row(0) == tuple(
        ts.filter(pl.col("team") == "NFL").height for _ in ranks
    )


def test_rank_direction(tables: dict[str, pl.DataFrame], manifest: dict[str, Any]) -> None:
    season = min(manifest["seasons"])
    ts = tables["team_season"].filter((pl.col("season") == season) & (pl.col("team") != "NFL"))
    best_off = ts.sort("off_epa_per_play", descending=True).row(0, named=True)
    assert best_off["rank_off_epa_per_play"] == 1
    best_def = ts.sort("def_epa_per_play").row(0, named=True)
    assert best_def["rank_def_epa_per_play"] == 1
    most_blitz = ts.sort("def_blitz_rate", descending=True).row(0, named=True)
    assert most_blitz["rank_def_blitz_rate"] == 1
    for col in [c for c in ts.columns if c.startswith("rank_")]:
        vals: list[int] = ts[col].drop_nulls().to_list()
        if vals:
            assert min(vals) == 1 and max(vals) <= 32, col


_D = "d[1-4]"
_DIST = "(short|medium|long|very_long)"
_ZONE = "(backed_up|own_territory|opp_territory|red_zone)"
_SCORE = "(trail_9plus|trail_1_8|tied|lead_1_8|lead_9plus)"
_TIME = "(two_minute|fourth_quarter|normal)"
CELL_KEY_PATTERNS = {
    "overall": "^all$",
    "down_dist": f"^{_D}-{_DIST}$",
    "down_dist_zone": f"^{_D}-{_DIST}-{_ZONE}$",
    "zone": f"^{_ZONE}$",
    "score_time": f"^{_SCORE}-{_TIME}$",
    "down_dist_score_time": f"^{_D}-{_DIST}-{_SCORE}-{_TIME}$",
}
DIMS = {
    "overall": set(),
    "down_dist": {"down", "dist_bucket"},
    "down_dist_zone": {"down", "dist_bucket", "field_zone"},
    "zone": {"field_zone"},
    "score_time": {"score_state", "time_bucket"},
    "down_dist_score_time": {"down", "dist_bucket", "score_state", "time_bucket"},
}


def test_cell_keys_and_dimensions(tables: dict[str, pl.DataFrame]) -> None:
    tt = tables["team_tendencies"]
    all_dims = ["down", "dist_bucket", "field_zone", "score_state", "time_bucket"]
    for grouping, pattern in CELL_KEY_PATTERNS.items():
        g = tt.filter(pl.col("grouping") == grouping)
        assert g.height
        assert g["cell_key"].str.contains(pattern).all(), grouping
        for dim in all_dims:
            nulls = g[dim].null_count()
            assert nulls == (0 if dim in DIMS[grouping] else g.height), (grouping, dim)
    assert not tt.select("season", "team", "side", "grouping", "cell_key").is_duplicated().any()
    assert (tt["low_sample"] == (tt["plays"] < 20)).all()
    assert tt.filter(pl.col("down") == 4).height > 0
