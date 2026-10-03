from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from audible_contracts.paths import SHARED_DIR

GOLDENS_DIR = SHARED_DIR / "factsheet" / "goldens"
GROUNDING_CASES = SHARED_DIR / "factsheet" / "grounding_cases.json"


def golden_names() -> list[str]:
    return sorted(p.name.removesuffix(".expected.json")
                  for p in GOLDENS_DIR.glob("*.expected.json"))


def load_golden(name: str) -> tuple[dict[str, Any], str]:
    g = json.loads((GOLDENS_DIR / f"{name}.json").read_text())
    return g, (GOLDENS_DIR / f"{name}.expected.json").read_text()


@pytest.fixture
def kc_bal_situation() -> dict[str, Any]:
    return {"role": "OC", "offense": "KC", "defense": "BAL", "season": 2026, "down": 3,
            "distance": 7, "yardline_100": 35, "quarter": 4, "clock_seconds": 110,
            "score_diff": -4, "timeouts_offense": 1, "timeouts_defense": 2}


@pytest.fixture
def tmp_json(tmp_path: Path):
    def write(name: str, obj: Any) -> Path:
        p = tmp_path / name
        p.write_text(json.dumps(obj))
        return p
    return write
