"""Writers for data/: zstd Parquet, schedule.json and manifest.json (plan §5.1, CONTRACTS §4.1)."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA_VERSION = "1.0.0"

PARQUET_FILES = ("team_season", "team_week", "team_tendencies", "player_season")


def arrow_table(df: pl.DataFrame) -> pa.Table:
    """Integers -> int32, floats (and all-null columns) -> float64, strings -> plain utf8."""
    fields: list[pa.Field] = []
    for name, dtype in df.schema.items():
        if dtype.is_integer():
            typ = pa.int32()
        elif dtype == pl.Boolean:
            typ = pa.bool_()
        elif dtype == pl.String:
            typ = pa.string()
        elif dtype.is_float() or dtype == pl.Null:
            typ = pa.float64()
        else:
            raise TypeError(f"unsupported column type {name}: {dtype}")
        fields.append(pa.field(name, typ, nullable=True))
    schema = pa.schema(fields)
    return (
        pa.Table.from_pylist(df.to_dicts(), schema=schema)
        if df.is_empty()
        else df.to_arrow().cast(schema)
    )


def write_parquet(df: pl.DataFrame, path: Path) -> None:
    pq.write_table(arrow_table(df), path, compression="zstd", compression_level=9)


def write_json(obj: Any, path: Path) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def file_entry(path: Path, rows: int) -> dict[str, Any]:
    data = path.read_bytes()
    return {
        "path": path.name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "rows": rows,
    }


def write_all(
    out: Path,
    *,
    tables: dict[str, pl.DataFrame],
    schedule_records: list[dict[str, Any]],
    current_season: int,
    current_week: int,
    seasons: list[int],
    stats_as_of: str | None,
    optional_fields_by_season: dict[str, list[int]],
) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    files: dict[str, Any] = {}
    for name in PARQUET_FILES:
        path = out / f"{name}.parquet"
        write_parquet(tables[name], path)
        files[name] = file_entry(path, tables[name].height)
    schedule_path = out / "schedule.json"
    write_json(schedule_records, schedule_path)
    files["schedule"] = file_entry(schedule_path, len(schedule_records))
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stats_as_of": stats_as_of,
        "current_season": current_season,
        "current_week": current_week,
        "seasons": seasons,
        "files": files,
        "optional_fields_by_season": optional_fields_by_season,
    }
    write_json(manifest, out / "manifest.json")
    return manifest
