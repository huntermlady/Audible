"""Shared builders for tests."""

from __future__ import annotations

import copy
from collections.abc import Iterator
from typing import Any

from audible_ai import factsheet
from audible_ai.data import load_fact_sheet_rows
from audible_ai.providers.base import GenerateResult
from audible_contracts.paths import FIXTURE_DATA_DIR

SITUATION = {"role": "OC", "offense": "KC", "defense": "BAL", "season": 2025, "down": 3,
             "distance": 7, "yardline_100": 35, "quarter": 4, "clock_seconds": 110,
             "score_diff": -4, "timeouts_offense": 1, "timeouts_defense": 2}


def situation_fs(**overrides: Any) -> dict[str, Any]:
    s = {**SITUATION, **overrides}
    rows = load_fact_sheet_rows(s["season"], [s["offense"], s["defense"], "NFL"], FIXTURE_DATA_DIR)
    return factsheet.build({"kind": "situation", "situation": s}, rows)


def matchup_fs(role: str = "OC") -> dict[str, Any]:
    ctx = {"kind": "matchup", "game_id": "2026_04_KC_BAL", "season": 2026, "team": "KC",
           "opponent": "BAL", "role": role}
    return factsheet.build(ctx, load_fact_sheet_rows(2026, ["KC", "BAL", "NFL"], FIXTURE_DATA_DIR))


def valid_call(fs: dict[str, Any], role: str = "OC") -> dict[str, Any]:
    f0, f1 = fs["facts"][0], fs["facts"][1]
    oc = role == "OC"
    opt = {"play_family": "quick_pass" if oc else None, "direction": "right" if oc else None,
           "concept": "Levels vs. expected pressure" if oc else "Cover 1 robber with a 5-man rush",
           "front": None if oc else "odd", "coverage_shell": None if oc else "cover1",
           "pressure": None if oc else "blitz"}
    alt = {**copy.deepcopy(opt), "concept": "Screen away", "when": "If they show six at the line"}
    return {
        "role": role, "primary": opt, "alternatives": [alt],
        "rationale": [
            {"text": f"{f0['label']} is {f0['display']}.", "stat_ids": [f0["id"]]},
            {"text": f"{f1['label']} is {f1['display']}.", "stat_ids": [f1["id"]]},
        ],
        "confidence": "medium", "caveats": [],
    }


def result(parsed: dict[str, Any] | None, raw: str = "{}") -> GenerateResult:
    return GenerateResult(raw_text=raw, parsed=parsed, latency_ms=5, first_token_ms=2,
                          prompt_tokens=10, output_tokens=20)


class ScriptedProvider:
    """Returns (or raises) the scripted responses in order."""

    name = "ollama"
    model = "scripted"

    def __init__(self, responses: list[Any]) -> None:
        self.responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def generate_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.2,
                      timeout_s: float = 120) -> GenerateResult:
        self.requests.append({"system": system, "user": user, "schema": schema})
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def stream_text(self, system: str, messages: list, *,
                    temperature: float = 0.4) -> Iterator[str]:
        yield "ok"
