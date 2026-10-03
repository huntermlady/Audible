"""Deterministic fake provider for tests and `--provider fake` dry runs (never a real call).

It reads the fact lines and the role/situation that `prompts.py` renders into the user prompt, and
returns schema-valid, grounded JSON. `fail_first=True` makes the first response of each
`generate_json` pair ungrounded so the retry path can be exercised.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from typing import Any

from audible_ai.providers.base import GenerateResult, Message

FACT_LINE = re.compile(r"^- (\S+) \| ([^|]+) \| (\S+)", re.MULTILINE)
ROLE = re.compile(r'"role": "(OC|DC)"')
INT_FIELD = r'"{}": (-?\d+)'


class FakeProvider:
    name = "fake"

    def __init__(self, model: str = "fake-1", *, fail_first: bool = False) -> None:
        self.model = model
        self.fail_first = fail_first
        self.calls = 0

    def _facts(self, user: str) -> list[tuple[str, str, str]]:
        return [(m.group(1), m.group(2).strip(), m.group(3)) for m in FACT_LINE.finditer(user)]

    def _int(self, user: str, name: str) -> int | None:
        m = re.search(INT_FIELD.format(name), user)
        return int(m.group(1)) if m else None

    def _call(self, role: str, facts: list[tuple[str, str, str]], down: int | None,
              distance: int | None, offset: int = 0) -> dict[str, Any]:
        picked = [facts[(offset + i) % len(facts)] for i in range(2)] if facts else []
        rationale = [{"text": f"{label} is {display}.", "stat_ids": [sid]}
                     for sid, label, display in picked]
        d, dist = down or 1, distance or 10
        if role == "OC":
            if d == 4 and dist <= 1:
                family = "sneak"
            elif d >= 3 and dist >= 7:
                family = "quick_pass"
            elif dist <= 2:
                family = "inside_run"
            else:
                family = "intermediate_pass"
            primary = {"play_family": family, "direction": "middle",
                       "concept": "Fake concept for testing", "front": None,
                       "coverage_shell": None, "pressure": None}
            alt = {"play_family": "screen", "direction": "left", "concept": "Fake screen",
                   "front": None, "coverage_shell": None, "pressure": None,
                   "when": "If the defense shows pressure"}
        else:
            long_yardage = d >= 3 and dist >= 7
            primary = {"play_family": None, "direction": None,
                       "concept": "Fake defensive concept for testing",
                       "front": "odd" if long_yardage else "even",
                       "coverage_shell": "cover1" if long_yardage else "cover3",
                       "pressure": "blitz" if long_yardage else "none"}
            alt = {"play_family": None, "direction": None, "concept": "Fake sim pressure",
                   "front": "even", "coverage_shell": "cover2", "pressure": "sim",
                   "when": "If the offense goes empty"}
        return {"role": role, "primary": primary, "alternatives": [alt], "rationale": rationale,
                "confidence": "medium",
                "caveats": ["Fake provider output for tests, not a real recommendation."]}

    def generate_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.2,
                      timeout_s: float = 120) -> GenerateResult:
        self.calls += 1
        facts = self._facts(user)
        m = ROLE.search(user)
        role = m.group(1) if m else "OC"
        if "situational_calls" in schema.get("properties", {}):
            slots = {"early_down": (1, 10), "third_short": (3, 2), "third_long": (3, 8),
                     "red_zone": (1, 10), "two_minute": (2, 10)}
            out: dict[str, Any] = {
                "headline": "Fake game plan for testing.",
                "keys": [{"title": f"Key {'ABC'[i]}", "detail": f"{label} is {display}.",
                          "stat_ids": [sid]}
                         for i, (sid, label, display) in enumerate(facts[:3])],
                "situational_calls": {
                    slot: self._call(role, facts, dn, dist, offset=i)
                    for i, (slot, (dn, dist)) in enumerate(slots.items())},
            }
        else:
            out = self._call(role, facts, self._int(user, "down"), self._int(user, "distance"))
        if self.fail_first and self.calls % 2 == 1:
            target = out["situational_calls"]["early_down"] if "situational_calls" in out else out
            target["caveats"] = ["Opponents converted 97.3% of these downs."]
        text = json.dumps(out)
        return GenerateResult(raw_text=text, parsed=out, latency_ms=1, first_token_ms=1,
                              prompt_tokens=len(user) // 4, output_tokens=len(text) // 4)

    def stream_text(self, system: str, messages: list[Message], *,
                    temperature: float = 0.4) -> Iterator[str]:
        yield from ("Fake ", "chat ", "reply.")
