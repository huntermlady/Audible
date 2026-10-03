"""Fact sheet builder. Implements shared/factsheet/SPEC.md; must stay byte-identical to
web/src/ai/factsheet.ts."""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Mapping
from typing import Any

FACT_SHEET_VERSION = "1.1.0"
MAX_FACTS = 40

Row = Mapping[str, Any]
FactSheet = dict[str, Any]

SITUATION_KEYS = (
    "role", "offense", "defense", "season", "down", "distance", "yardline_100", "quarter",
    "clock_seconds", "score_diff", "timeouts_offense", "timeouts_defense",
)

EPA_METRICS = frozenset({"epa_per_play", "pass_epa", "run_epa"})

METRIC_LABELS = {
    "plays": "plays",
    "pass_rate": "pass rate",
    "proe": "pass rate over expected",
    "epa_per_play": "EPA/play",
    "success_rate": "success rate",
    "explosive_rate": "explosive-play rate",
    "pass_epa": "EPA/dropback",
    "run_epa": "EPA/run",
    "pass_success_rate": "dropback success rate",
    "run_success_rate": "run success rate",
    "avg_air_yards": "average air yards",
    "deep_pass_rate": "deep pass rate",
    "screen_rate": "screen rate",
    "play_action_rate": "play-action rate",
    "shotgun_rate": "shotgun rate",
    "no_huddle_rate": "no-huddle rate",
    "run_left_rate": "share of runs left",
    "run_middle_rate": "share of runs middle",
    "run_right_rate": "share of runs right",
    "pass_left_rate": "share of passes left",
    "pass_middle_rate": "share of passes middle",
    "pass_right_rate": "share of passes right",
    "sack_rate": "sack rate",
    "blitz_rate": "blitz rate",
    "pressure_rate": "pressure rate",
    "man_rate": "man coverage rate",
    "zone_rate": "zone coverage rate",
}

DOWN_LABELS = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}
DIST_LABELS = {"short": "short", "medium": "medium", "long": "long", "very_long": "very long"}
ZONE_LABELS = {
    "backed_up": "backed up",
    "own_territory": "own territory",
    "opp_territory": "opponent territory",
    "red_zone": "red zone",
}
SCORE_LABELS = {
    "trail_9plus": "trailing by two scores or more",
    "trail_1_8": "trailing by one score",
    "tied": "tied",
    "lead_1_8": "leading by one score",
    "lead_9plus": "leading by two scores or more",
}
TIME_LABELS = {"two_minute": "two-minute", "fourth_quarter": "fourth quarter",
               "normal": "normal clock"}

SITUATION_METRICS: dict[str, dict[str, tuple[str, ...]]] = {
    "situational": {
        "off": ("pass_rate", "proe", "success_rate", "pass_success_rate", "run_success_rate",
                "epa_per_play", "explosive_rate", "sack_rate", "screen_rate"),
        "def": ("success_rate", "pass_success_rate", "run_success_rate", "epa_per_play",
                "explosive_rate", "sack_rate", "blitz_rate", "pressure_rate", "man_rate"),
    },
    "zone": {
        "off": ("pass_rate", "success_rate", "epa_per_play"),
        "def": ("success_rate", "epa_per_play", "pass_success_rate"),
    },
    "score_time": {
        "off": ("pass_rate", "success_rate", "no_huddle_rate"),
        "def": ("success_rate", "blitz_rate", "zone_rate"),
    },
    "overall": {
        "off": ("epa_per_play", "success_rate", "pass_rate", "proe", "explosive_rate"),
        "def": ("epa_per_play", "success_rate", "explosive_rate", "blitz_rate", "pressure_rate"),
    },
}

MATCHUP_METRICS: dict[str, dict[str, tuple[str, ...]]] = {
    "overall": SITUATION_METRICS["overall"],
    "early_down": {
        "off": ("pass_rate", "proe", "success_rate", "play_action_rate"),
        "def": ("success_rate", "run_success_rate", "pass_success_rate", "explosive_rate"),
    },
    "third_short": {
        "off": ("pass_rate", "success_rate", "run_success_rate"),
        "def": ("success_rate", "run_success_rate", "blitz_rate"),
    },
    "third_long": {
        "off": ("pass_success_rate", "sack_rate", "screen_rate"),
        "def": ("pass_success_rate", "blitz_rate", "man_rate"),
    },
    "red_zone": {
        "off": ("pass_rate", "success_rate", "epa_per_play"),
        "def": ("success_rate", "epa_per_play", "pass_success_rate"),
    },
    "two_minute": {
        "off": ("pass_rate", "success_rate"),
        "def": ("pass_success_rate", "zone_rate"),
    },
}

MATCHUP_SLOTS: tuple[tuple[str, bool, tuple[tuple[str, str], ...]], ...] = (
    ("overall", True, (("overall", "all"),)),
    ("early_down", True, (("down_dist", "d1-long"),)),
    ("third_short", True, (("down_dist", "d3-short"),)),
    ("third_long", True, (("down_dist", "d3-long"),)),
    ("red_zone", True, (("zone", "red_zone"),)),
    ("two_minute", True, (("score_time", "trail_1_8-two_minute"),)),
)


# ---------------------------------------------------------------- derived buckets

def dist_bucket(distance: int) -> str:
    if distance <= 3:
        return "short"
    if distance <= 6:
        return "medium"
    if distance <= 10:
        return "long"
    return "very_long"


def field_zone(yardline_100: int) -> str:
    if yardline_100 >= 90:
        return "backed_up"
    if yardline_100 >= 50:
        return "own_territory"
    if yardline_100 >= 21:
        return "opp_territory"
    return "red_zone"


def score_state(score_diff: int) -> str:
    if score_diff <= -9:
        return "trail_9plus"
    if score_diff <= -1:
        return "trail_1_8"
    if score_diff == 0:
        return "tied"
    if score_diff <= 8:
        return "lead_1_8"
    return "lead_9plus"


def time_bucket(quarter: int, clock_seconds: int) -> str:
    if quarter in (2, 4) and clock_seconds <= 120:
        return "two_minute"
    if quarter in (4, 5):
        return "fourth_quarter"
    return "normal"


def derive(situation: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "down": situation["down"],
        "dist_bucket": dist_bucket(situation["distance"]),
        "field_zone": field_zone(situation["yardline_100"]),
        "score_state": score_state(situation["score_diff"]),
        "time_bucket": time_bucket(situation["quarter"], situation["clock_seconds"]),
    }


# ---------------------------------------------------------------- numbers

def _rha(x: float) -> int:
    """Round half away from zero."""
    r = math.floor(abs(x) + 0.5)
    return -r if x < 0 else r


def _k(raw: float) -> int:
    return _rha(raw * 10000)


def round4(raw: float) -> int | float:
    k = _k(raw)
    if k % 10000 == 0:
        return k // 10000
    return k / 10000


def format_value(unit: str, raw: float) -> str:
    if unit == "count":
        return str(int(raw))
    k = _k(raw)
    a = abs(k)
    if unit == "rate":
        p = (a + 50) // 100
        return f"-{p}%" if k < 0 and p > 0 else f"{p}%"
    if unit == "epa":
        c = (a + 50) // 100
        if c == 0:
            return "0.00"
        return f"{'+' if k > 0 else '-'}{c // 100}.{c % 100:02d}"
    if unit == "yards":
        t = (a + 500) // 1000
        return f"{'-' if k < 0 and t > 0 else ''}{t // 10}.{t % 10}"
    raise ValueError(f"unknown unit {unit!r}")


def metric_unit(metric: str) -> str:
    if metric in EPA_METRICS:
        return "epa"
    if metric == "avg_air_yards":
        return "yards"
    if metric == "plays":
        return "count"
    return "rate"


# ---------------------------------------------------------------- labels

def cell_label(row: Row) -> str:
    if row["grouping"] == "overall":
        return "all plays"
    parts: list[str] = []
    if row.get("down") is not None and row.get("dist_bucket") is not None:
        parts.append(f"{DOWN_LABELS[row['down']]} & {DIST_LABELS[row['dist_bucket']]}")
    if row.get("field_zone") is not None:
        parts.append(ZONE_LABELS[row["field_zone"]])
    if row.get("score_state") is not None:
        parts.append(SCORE_LABELS[row["score_state"]])
    if row.get("time_bucket") is not None:
        parts.append(TIME_LABELS[row["time_bucket"]])
    return ", ".join(parts)


def fact_label(team: str, side: str, metric: str, row: Row, season: int) -> str:
    side_word = "offense" if side == "off" else "defense"
    label = f"{team} {side_word}: {METRIC_LABELS[metric]}, {cell_label(row)}"
    # Prior-season fallback facts name their season (SPEC §4); it is the only non-ordinal digit.
    return label if row["season"] == season else f"{label} ({row['season']})"


# ---------------------------------------------------------------- context

def normalize_context(ctx: Mapping[str, Any]) -> dict[str, Any]:
    if ctx["kind"] == "situation":
        s = ctx["situation"]
        return {"kind": "situation", "situation": {k: s[k] for k in SITUATION_KEYS}}
    if ctx["kind"] == "matchup":
        return {k: ctx[k] for k in ("kind", "game_id", "season", "team", "opponent", "role")}
    if ctx["kind"] == "team":
        return {k: ctx[k] for k in ("kind", "season", "team")}
    raise ValueError(f"unknown fact sheet context kind {ctx['kind']!r}")


def _blocks(ctx: Mapping[str, Any]) -> list[tuple[str, str]]:
    if ctx["kind"] == "situation":
        s = ctx["situation"]
        off, de = (s["offense"], "off"), (s["defense"], "def")
        return [off, de] if s["role"] == "OC" else [de, off]
    if ctx["kind"] == "team":
        return [(ctx["team"], "off"), (ctx["team"], "def")]
    own_side, opp_side = ("off", "def") if ctx["role"] == "OC" else ("def", "off")
    return [(ctx["team"], own_side), (ctx["opponent"], opp_side)]


def context_season(ctx: Mapping[str, Any]) -> int:
    return ctx["situation"]["season"] if ctx["kind"] == "situation" else ctx["season"]


def inputs(ctx: Mapping[str, Any]) -> dict[str, Any]:
    teams: list[str] = []
    for team, _ in _blocks(ctx):
        if team not in teams:
            teams.append(team)
    teams.append("NFL")
    season = context_season(ctx)
    return {"season": season, "seasons": [season, season - 1], "teams": teams}


def _slots(ctx: Mapping[str, Any]):
    """Yield (slot_name, required, candidates, metric_table)."""
    if ctx["kind"] in ("matchup", "team"):
        for name, required, cands in MATCHUP_SLOTS:
            yield name, required, cands, MATCHUP_METRICS[name]
        return
    d = derive(ctx["situation"])
    dd = f"d{d['down']}-{d['dist_bucket']}"
    ddz = ("down_dist_zone", f"{dd}-{d['field_zone']}")
    ddst = ("down_dist_score_time", f"{dd}-{d['score_state']}-{d['time_bucket']}")
    narrow = (ddz, ddst) if d["field_zone"] in ("red_zone", "backed_up") else (ddst, ddz)
    situational = (*narrow, ("down_dist", dd), ("overall", "all"))
    yield "situational", True, situational, SITUATION_METRICS["situational"]
    yield "zone", False, (("zone", d["field_zone"]),), SITUATION_METRICS["zone"]
    yield ("score_time", False, (("score_time", f"{d['score_state']}-{d['time_bucket']}"),),
           SITUATION_METRICS["score_time"])
    yield "overall", True, (("overall", "all"),), SITUATION_METRICS["overall"]


def _choose(index: Mapping[tuple, Row], season: int, team: str, side: str,
            candidates: Iterable[tuple[str, str]], required: bool) -> Row | None:
    """SPEC §4: each non-overall candidate is tried in the context season, then (only if not
    low_sample) in the prior season, before moving to the next, broader candidate."""
    existing: list[Row] = []
    for grouping, cell_key in candidates:
        row = index.get((season, team, side, grouping, cell_key))
        if row is not None:
            if not row["low_sample"]:
                return row
            existing.append(row)
        if grouping != "overall":
            prior = index.get((season - 1, team, side, grouping, cell_key))
            if prior is not None and not prior["low_sample"]:
                return prior
    if required and existing:
        return existing[-1]
    return None


def build(ctx: Mapping[str, Any], tendencies: Iterable[Row]) -> FactSheet:
    context = normalize_context(ctx)
    season = context_season(context)
    index: dict[tuple, Row] = {}
    for row in tendencies:
        key = (row["season"], row["team"], row["side"], row["grouping"], row["cell_key"])
        index.setdefault(key, row)

    facts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for team, side in _blocks(context):
        for _name, required, candidates, metric_table in _slots(context):
            row = _choose(index, season, team, side, candidates, required)
            if row is None:
                continue
            row_season = row["season"]
            league = index.get((row_season, "NFL", "off", row["grouping"], row["cell_key"]))
            for metric in metric_table[side]:
                raw = row.get(metric)
                if raw is None:
                    continue
                stat_id = f"{team}.{side}.{row_season}.{row['grouping']}.{row['cell_key']}.{metric}"
                if stat_id in seen:
                    continue
                seen.add(stat_id)
                unit = metric_unit(metric)
                league_raw = league.get(metric) if league is not None else None
                league_display = None if league_raw is None else format_value(unit, league_raw)
                facts.append({
                    "id": stat_id,
                    "label": fact_label(team, side, metric, row, season),
                    "value": round4(raw),
                    "display": format_value(unit, raw),
                    "unit": unit,
                    "n": int(row["plays"]),
                    "low_sample": bool(row["low_sample"]),
                    "league_value": None if league_raw is None else round4(league_raw),
                    "league_display": league_display,
                })

    return {
        "fact_sheet_version": FACT_SHEET_VERSION,
        "context": context,
        "derived": derive(context["situation"]) if context["kind"] == "situation" else None,
        "facts": facts[:MAX_FACTS],
    }


def dumps(fs: FactSheet) -> str:
    """Canonical serialization (SPEC §9); matches JSON.stringify(fs, null, 2)."""
    return json.dumps(fs, indent=2, ensure_ascii=False)


def fact_index(fs: FactSheet) -> dict[str, dict[str, Any]]:
    return {f["id"]: f for f in fs["facts"]}
