"""Readers for data/ (pipeline or `make mock-data` output) and shared/fixtures/data (JSON)."""

from __future__ import annotations

import gzip
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from audible_contracts.paths import FIXTURE_DATA_DIR, REPO_ROOT

DATA_DIR = REPO_ROOT / "data"
REPORTS_DIR = REPO_ROOT / "reports"

Row = dict[str, Any]


def load_manifest(data_dir: Path = DATA_DIR) -> dict[str, Any]:
    return json.loads((data_dir / "manifest.json").read_text())


def load_schedule(data_dir: Path = DATA_DIR) -> list[Row]:
    return json.loads((data_dir / "schedule.json").read_text())


def _filter(rows: Iterable[Row], season: int, teams: Iterable[str] | None) -> list[Row]:
    wanted = set(teams) if teams is not None else None
    return [r for r in rows
            if r["season"] == season and (wanted is None or r["team"] in wanted)]


def load_tendencies(season: int, teams: Iterable[str] | None = None,
                    data_dir: Path = DATA_DIR) -> list[Row]:
    """Tendency rows for one season (optionally only some teams): parquet, .json or .json.gz."""
    parquet = data_dir / "team_tendencies.parquet"
    if parquet.exists():
        import pyarrow.parquet as pq

        filters: list[Any] = [("season", "=", season)]
        if teams is not None:
            filters.append(("team", "in", list(teams)))
        return pq.read_table(parquet, filters=filters).to_pylist()
    plain = data_dir / "team_tendencies.json"
    if plain.exists():
        return _filter(json.loads(plain.read_text()), season, teams)
    with gzip.open(data_dir / "team_tendencies.json.gz", "rt", encoding="utf-8") as f:
        return _filter(json.load(f), season, teams)


def load_fixture_tendencies(season: int, teams: Iterable[str] | None = None) -> list[Row]:
    return load_tendencies(season, teams, FIXTURE_DATA_DIR)


def load_fact_sheet_rows(season: int, teams: Iterable[str] | None = None,
                         data_dir: Path = DATA_DIR) -> list[Row]:
    """Rows a fact sheet for `season` needs: that season plus the prior season (the low-sample
    fallback, SPEC §4). Missing prior seasons simply contribute no rows."""
    wanted = list(teams) if teams is not None else None
    return load_tendencies(season, wanted, data_dir) + load_tendencies(season - 1, wanted, data_dir)
