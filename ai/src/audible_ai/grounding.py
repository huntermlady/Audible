"""Number-grounding check (shared/factsheet/SPEC.md §11). Must agree with
web/src/ai/grounding.ts on shared/factsheet/grounding_cases.json."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

MASK_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:cover[ -]?[0-9]+|[0-9]+[ -]man|[0-9]{2} personnel|[0-9]-technique"
    r"|[0-9]-tech)(?![A-Za-z0-9_])",
    re.IGNORECASE,
)
TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_.])(?:([0-9]{1,2}):([0-9]{2})|([0-9]+)-([0-9]+)(?![0-9])"
    r"|([0-9]+)(st|nd|rd|th)(?![A-Za-z])|([+-]?)([0-9]+(?:\.[0-9]+)?|\.[0-9]+)(%?))"
)


@dataclass
class GroundingResult:
    grounded: bool
    ungrounded: list[dict[str, Any]] = field(default_factory=list)


def _display_number(display: str) -> float:
    return abs(float(display.replace("%", "").replace("+", "")))


def candidates(fs: Mapping[str, Any] | None,
               situation: Mapping[str, Any] | None = None) -> list[tuple[float, str]]:
    out: list[tuple[float, str]] = []

    def add_value(unit: str, value: float, display: str) -> None:
        v = abs(value)
        if unit == "rate":
            out.extend([(v * 100, "pct"), (v, "frac"), (_display_number(display), "pct")])
        elif unit == "epa":
            out.extend([(v, "frac"), (_display_number(display), "frac")])
        else:
            out.append((v, "num"))

    if fs is not None:
        for f in fs["facts"]:
            add_value(f["unit"], f["value"], f["display"])
            if f["league_value"] is not None and f["league_display"] is not None:
                add_value(f["unit"], f["league_value"], f["league_display"])
            out.append((float(f["n"]), "num"))
            out.append((float(f["id"].split(".")[2]), "num"))  # the fact's season (SPEC §11.3)
        ctx = fs["context"]
        if ctx["kind"] in ("matchup", "team"):
            out.append((float(ctx["season"]), "num"))
    if situation is not None:
        s = situation
        for v in (s["down"], s["distance"], s["yardline_100"], 100 - s["yardline_100"],
                  s["quarter"], s["clock_seconds"], abs(s["score_diff"]), s["timeouts_offense"],
                  s["timeouts_defense"], s["season"]):
            out.append((float(v), "num"))
    return out


def _plain_grounded(x: float, decimals: int, percent: bool,
                    cands: list[tuple[float, str]]) -> bool:
    tol = 0.5 * 10 ** -decimals + 1e-9
    for c, kind in cands:
        eligible = kind == "pct" or (
            not percent and (kind == "num" or (kind == "frac" and decimals >= 1)))
        if eligible and abs(x - c) <= tol:
            return True
    return False


def _decimals(num: str) -> int:
    return len(num.split(".", 1)[1]) if "." in num else 0


def check_grounding(text: str, fs: Mapping[str, Any] | None,
                    situation: Mapping[str, Any] | None = None) -> GroundingResult:
    if situation is None and fs is not None and fs["context"]["kind"] == "situation":
        situation = fs["context"]["situation"]
    cands = candidates(fs, situation)
    masked = MASK_RE.sub(lambda m: " " * len(m.group(0)), text)
    ungrounded: list[dict[str, Any]] = []
    for m in TOKEN_RE.finditer(masked):
        if m.group(1) is not None:
            ok = situation is not None and (
                int(m.group(1)) * 60 + int(m.group(2)) == situation["clock_seconds"])
        elif m.group(3) is not None:
            ok = all(_plain_grounded(float(g), 0, False, cands) for g in (m.group(3), m.group(4)))
        elif m.group(5) is not None:
            ok = 1 <= int(m.group(5)) <= 4
        else:
            num = m.group(8)
            ok = _plain_grounded(abs(float(num)), _decimals(num), m.group(9) == "%", cands)
        if not ok:
            ungrounded.append({"token": text[m.start():m.end()], "start": m.start(),
                               "end": m.end()})
    return GroundingResult(grounded=not ungrounded, ungrounded=ungrounded)
