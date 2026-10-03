"""Shared fixtures: one real pipeline build (network on first run, then ~/.cache/audible)."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from audible_pipeline import cli, ingest

# 2021: no FTN charting; 2024: full coverage; 2026 (in progress): no participation yet.
BUILD_SEASONS = [2021, 2024, 2026]


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get("AUDIBLE_OFFLINE") == "1":
        skip = pytest.mark.skip(reason="AUDIBLE_OFFLINE=1: needs nflverse data")
        for item in items:
            if "network" in item.keywords:
                item.add_marker(skip)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "network: needs nflverse downloads (or a warm cache)")


@pytest.fixture(scope="session")
def built(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, dict[str, Any]]:
    """Build a small data/ -- or, with AUDIBLE_VALIDATE_DIR=data, check an existing full build."""
    existing = os.environ.get("AUDIBLE_VALIDATE_DIR")
    if existing:
        out = Path(existing)
        return out, json.loads((out / "manifest.json").read_text())
    out = tmp_path_factory.mktemp("data")
    manifest = cli.build(BUILD_SEASONS, out)
    return out, manifest


@pytest.fixture(scope="session")
def out_dir(built: tuple[Path, dict[str, Any]]) -> Path:
    return built[0]


@pytest.fixture(scope="session")
def manifest(built: tuple[Path, dict[str, Any]]) -> dict[str, Any]:
    return built[1]


@pytest.fixture(scope="session")
def tables(out_dir: Path) -> dict[str, pl.DataFrame]:
    return {
        name: pl.read_parquet(out_dir / f"{name}.parquet")
        for name in ("team_season", "team_week", "team_tendencies", "player_season")
    }


@pytest.fixture(scope="session")
def raw_pbp(manifest: dict[str, Any]) -> Callable[[int], pl.DataFrame]:
    """Raw pbp for a season in the build under test (skips when the build lacks it)."""
    cache: dict[int, pl.DataFrame] = {}

    def get(season: int) -> pl.DataFrame:
        if season not in manifest["seasons"]:
            pytest.skip(f"season {season} not in this build")
        if season not in cache:
            df = ingest.load_pbp(season)
            assert df is not None
            cache[season] = df
        return cache[season]

    return get


@pytest.fixture(scope="session")
def require_season(manifest: dict[str, Any]) -> Callable[[int], None]:
    def check(season: int) -> None:
        if season not in manifest["seasons"]:
            pytest.skip(f"season {season} not in this build")

    return check
