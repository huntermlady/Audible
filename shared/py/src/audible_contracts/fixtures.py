"""Read the committed mock data in shared/fixtures/data.

Tables are JSON arrays of row objects. team_tendencies is gzip-compressed (`.json.gz`, ~17 MB raw),
and `load_rows` hides that detail, so callers should always go through it.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

from audible_contracts.paths import FIXTURE_DATA_DIR

PARQUET_TABLES = ("team_season", "team_week", "team_tendencies", "player_season")
GZIPPED = frozenset({"team_tendencies"})
Row = dict[str, Any]


def table_path(name: str, root: Path = FIXTURE_DATA_DIR) -> Path:
    return root / (f"{name}.json.gz" if name in GZIPPED else f"{name}.json")


def load_rows(name: str, root: Path = FIXTURE_DATA_DIR) -> list[Row]:
    """Rows of a fixture table: one of PARQUET_TABLES or `schedule`."""
    path = table_path(name, root)
    raw = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    return json.loads(raw)


def load_manifest(root: Path = FIXTURE_DATA_DIR) -> Row:
    return json.loads((root / "manifest.json").read_text())


def dumps_rows(rows: list[Row]) -> str:
    """A JSON array with one compact row per line (small diffs, easy greps)."""
    body = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
    return f"[\n{body}\n]\n"


def write_rows(name: str, rows: list[Row], root: Path = FIXTURE_DATA_DIR) -> None:
    path = table_path(name, root)
    text = dumps_rows(rows).encode()
    if name in GZIPPED:
        path.write_bytes(gzip.compress(text, compresslevel=9, mtime=0))  # mtime=0: deterministic
    else:
        path.write_bytes(text)
