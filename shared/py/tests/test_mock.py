"""`python -m audible_contracts.mock` writes schema-conformant parquet and an accurate manifest."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from audible_contracts import mock
from audible_contracts.fixtures import PARQUET_TABLES, load_rows
from audible_contracts.models import Manifest


@pytest.fixture(scope="module")
def out(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("mock")
    assert mock.main(["--out", str(root / "data"), "--reports", str(root / "reports")]) == 0
    return root


def test_writes_every_file(out: Path) -> None:
    names = {p.name for p in (out / "data").iterdir()}
    assert names == {f"{t}.parquet" for t in PARQUET_TABLES} | {"schedule.json", "manifest.json"}


def test_manifest_hashes_bytes_rows(out: Path) -> None:
    manifest = json.loads((out / "data" / "manifest.json").read_text())
    Manifest.model_validate(manifest)
    for name, entry in manifest["files"].items():
        data = (out / "data" / entry["path"]).read_bytes()
        assert entry["sha256"] == hashlib.sha256(data).hexdigest(), name
        assert entry["bytes"] == len(data), name
        if entry["path"].endswith(".parquet"):
            assert pq.read_metadata(out / "data" / entry["path"]).num_rows == entry["rows"]
        else:
            assert len(json.loads(data)) == entry["rows"]


@pytest.mark.parametrize("table", PARQUET_TABLES)
def test_parquet_dtypes_and_round_trip(out: Path, table: str) -> None:
    path = out / "data" / f"{table}.parquet"
    assert pq.read_metadata(path).row_group(0).column(0).compression == "ZSTD"
    arrow = pq.read_table(path)
    assert arrow.schema.equals(mock.arrow_schema(table))
    for f in arrow.schema:
        if f.name in {"season", "week", "down", "plays", "games"} or f.name.startswith("rank_"):
            assert f.type == pa.int32(), f.name
        elif f.name.endswith(("_rate", "epa_per_play")) or f.name in {"proe", "cpoe"}:
            assert f.type == pa.float64(), f.name
        if f.name in {"is_home", "low_sample"}:
            assert f.type == pa.bool_(), f.name
    assert arrow.to_pylist() == load_rows(table)


def test_reports_seeded_once(out: Path, tmp_path: Path) -> None:
    reports = out / "reports"
    assert (reports / "index.json").exists()
    assert (reports / "2026" / "4" / "2026_04_KC_BAL.KC.OC.json").exists()
    assert (reports / "samples" / "playcaller.json").exists()
    # An existing index is never overwritten.
    custom = tmp_path / "reports"
    custom.mkdir()
    (custom / "index.json").write_text("[]\n")
    assert mock.seed_reports(custom) is False
    assert (custom / "index.json").read_text() == "[]\n"
    assert not (custom / "samples").exists()
