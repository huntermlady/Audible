"""Write mock `data/` (and seed `reports/`) from shared/fixtures, for work without the pipeline.

    python -m audible_contracts.mock --out data [--reports reports]

Writes the four parquet tables (zstd, dtypes per CONTRACTS §4.1), schedule.json, and a manifest.json
with real sha256/bytes/rows. Copies shared/fixtures/reports -> reports/ only if reports/index.json
is absent, so real generated reports are never overwritten.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from audible_contracts.fixtures import PARQUET_TABLES, Row, load_manifest, load_rows
from audible_contracts.paths import FIXTURE_REPORTS_DIR, SCHEMAS_DIR

SCHEMA_FILES = {
    "team_season": "team_season_row.schema.json",
    "team_week": "team_week_row.schema.json",
    "team_tendencies": "team_tendency_row.schema.json",
    "player_season": "player_season_row.schema.json",
}
ARROW_TYPES = {
    "integer": pa.int32(),
    "number": pa.float64(),
    "boolean": pa.bool_(),
    "string": pa.string(),
}


def arrow_schema(table: str) -> pa.Schema:
    """Parquet schema derived from the row JSON Schema: int32 / float64 / bool / string."""
    doc = json.loads((SCHEMAS_DIR / SCHEMA_FILES[table]).read_text())
    fields = []
    for name, prop in doc["properties"].items():
        types = prop["type"] if isinstance(prop["type"], list) else [prop["type"]]
        base = next(t for t in types if t != "null")
        fields.append(pa.field(name, ARROW_TYPES[base], nullable="null" in types))
    return pa.schema(fields)


def write_parquet(table: str, rows: list[Row], path: Path) -> None:
    schema = arrow_schema(table)
    pq.write_table(pa.Table.from_pylist(rows, schema=schema), path, compression="zstd")


def file_entry(path: Path, rows: int) -> dict[str, Any]:
    data = path.read_bytes()
    return {
        "path": path.name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "rows": rows,
    }


def write_data(out: Path) -> dict[str, Any]:
    """Write every data file into `out` and return the manifest (also written to disk)."""
    out.mkdir(parents=True, exist_ok=True)
    base = load_manifest()
    files: dict[str, Any] = {}
    for table in PARQUET_TABLES:
        rows = load_rows(table)
        path = out / f"{table}.parquet"
        write_parquet(table, rows, path)
        files[table] = file_entry(path, len(rows))
    schedule = load_rows("schedule")
    (out / "schedule.json").write_text(json.dumps(schedule, ensure_ascii=False) + "\n")
    files["schedule"] = file_entry(out / "schedule.json", len(schedule))
    manifest = {
        "schema_version": base["schema_version"],
        "generated_at": base["generated_at"],
        "stats_as_of": base["stats_as_of"],
        "current_season": base["current_season"],
        "current_week": base["current_week"],
        "seasons": base["seasons"],
        "files": files,
        "optional_fields_by_season": base["optional_fields_by_season"],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def seed_reports(reports: Path) -> bool:
    """Copy fixture reports into `reports` unless it has an index already; True if copied."""
    if (reports / "index.json").exists():
        return False
    shutil.copytree(FIXTURE_REPORTS_DIR, reports, dirs_exist_ok=True)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write mock data/ from shared/fixtures.")
    parser.add_argument("--out", type=Path, default=Path("data"))
    parser.add_argument("--reports", type=Path, default=Path("reports"))
    args = parser.parse_args(argv)
    manifest = write_data(args.out)
    for name, f in manifest["files"].items():
        print(f"{args.out / f['path']}: {f['rows']} rows, {f['bytes']} bytes ({name})")
    if seed_reports(args.reports):
        print(f"Seeded {args.reports}/ from shared/fixtures/reports")
    else:
        print(f"{args.reports}/index.json exists; left reports untouched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
