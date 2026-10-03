"""Regenerate the mock reports and Play-Caller samples in shared/fixtures/reports.

    uv run python ai/scripts/make_fixture_reports.py

The fact sheets come from the real SPEC.md builder over shared/fixtures data. The prose comes from a
small deterministic template author (no model): every number it writes is a fact's `display` or
`league_display`, and every output passes the same validation the batch job uses. The output is
stamped provider "fake", model "fixture-mock".
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from audible_ai import factsheet, schemas
from audible_ai.data import load_fact_sheet_rows, load_manifest
from audible_ai.reports import CALL_SLOTS, REPORT_VERSION, index_entry, report_path
from audible_ai.validate import validate_call, validate_report_body
from audible_contracts.paths import FIXTURE_DATA_DIR, FIXTURE_REPORTS_DIR

MODEL = "fixture-mock"
PROVIDER = "fake"
GENERATED_AT = "2026-09-22T03:12:00Z"
GAME = {"game_id": "2026_04_KC_BAL", "season": 2026, "week": 4}
REPORTS = (("KC", "BAL", "OC"), ("BAL", "KC", "DC"))
SAMPLE_SITUATIONS = (
    {"role": "OC", "offense": "KC", "defense": "BAL", "season": 2026, "down": 3, "distance": 7,
     "yardline_100": 35, "quarter": 4, "clock_seconds": 130, "score_diff": -4,
     "timeouts_offense": 1, "timeouts_defense": 2},
    {"role": "DC", "offense": "KC", "defense": "BAL", "season": 2026, "down": 1, "distance": 10,
     "yardline_100": 75, "quarter": 1, "clock_seconds": 840, "score_diff": 0,
     "timeouts_offense": 3, "timeouts_defense": 3},
    {"role": "OC", "offense": "PHI", "defense": "DAL", "season": 2026, "down": 2, "distance": 6,
     "yardline_100": 12, "quarter": 2, "clock_seconds": 300, "score_diff": 0,
     "timeouts_offense": 3, "timeouts_defense": 3},
)
# Matchup slot → the cell its facts come from (factsheet.MATCHUP_SLOTS).
SLOT_CELLS = {name: cands[0] for name, _req, cands in factsheet.MATCHUP_SLOTS}
SLOT_PHRASES = {
    "overall": "every down", "early_down": "early downs", "third_short": "third and short",
    "third_long": "third and long", "red_zone": "the red zone",
    "two_minute": "the two-minute drill",
}
SLOT_TITLES = {"overall": "Overall", "early_down": "Early downs", "third_short": "Third and short",
               "third_long": "Third and long", "red_zone": "Red zone", "two_minute": "Two-minute"}

Fact = Mapping[str, Any]


# ---------------------------------------------------------------- fact helpers

def edge(f: Fact) -> float:
    """How far a fact sits from the league value (0 when there is none)."""
    return 0.0 if f["league_value"] is None else f["value"] - f["league_value"]


def compare(f: Fact) -> str:
    d = edge(f)
    if abs(d) < 0.02:
        return "in line with"
    return "above" if d > 0 else "below"


def sentence(f: Fact) -> str:
    """Grounded sentence: label, display and league display only."""
    if f["league_display"] is None:
        return f"{f['label']}: {f['display']}."
    return f"{f['label']}: {f['display']}, {compare(f)} the league's {f['league_display']}."


def ranked(facts: list[Fact]) -> list[Fact]:
    return sorted(facts, key=lambda f: (-abs(edge(f)), f["id"]))


def cell_facts(fs: Mapping[str, Any], grouping: str, cell_key: str) -> list[Fact]:
    return [f for f in fs["facts"] if f["id"].split(".")[3:5] == [grouping, cell_key]]


def metric(facts: list[Fact], team: str, name: str) -> Fact | None:
    return next((f for f in facts if f["id"].startswith(f"{team}.") and
                 f["id"].endswith(f".{name}")), None)


def above(f: Fact | None, margin: float = 0.0) -> bool:
    return f is not None and edge(f) > margin


# ---------------------------------------------------------------- calls

def option(role: str, family: str | None = None, direction: str | None = None,
           front: str | None = None, shell: str | None = None, pressure: str | None = None,
           *, concept: str, when: str | None = None) -> dict[str, Any]:
    oc = role == "OC"
    out = {"play_family": family if oc else None, "direction": direction if oc else None,
           "concept": concept, "front": None if oc else front,
           "coverage_shell": None if oc else shell, "pressure": None if oc else pressure}
    if when is not None:
        out["when"] = when
    return out


def oc_choice(slot: str, facts: list[Fact], own: str, opp: str) -> tuple[dict, dict]:
    blitz = metric(facts, opp, "blitz_rate")
    if slot == "third_long" or (slot == "situational" and above(blitz, 0.05)):
        if above(blitz, 0.05):
            return (option("OC", "screen", "left", concept="Slow screen away from the pressure"),
                    option("OC", "quick_pass", "right", concept="Hot throw to the slot",
                           when="If the safety rotates down to blitz"))
        return (option("OC", "intermediate_pass", "middle", concept="Dagger over the middle"),
                option("OC", "screen", "left", concept="Running back screen",
                       when="If they rush six or more"))
    if slot == "third_short":
        if above(metric(facts, own, "run_success_rate")):
            return (option("OC", "inside_run", "middle", concept="Duo behind the guards"),
                    option("OC", "quick_pass", "right", concept="Quick out to the flat",
                           when="If they load the box"))
        return (option("OC", "quick_pass", "right", concept="Stick concept to the sticks"),
                option("OC", "qb_run", "middle", concept="Quarterback sneak",
                       when="If the defense plays off coverage"))
    if slot in ("red_zone", "two_minute"):
        return (option("OC", "quick_pass", "right", concept="Fade-slant combination"),
                option("OC", "inside_run", "middle", concept="Inside zone",
                       when="If the defense drops eight"))
    if above(metric(facts, own, "proe")) or above(metric(facts, own, "pass_rate")):
        return (option("OC", "play_action", "right", concept="Play-action boot off outside zone"),
                option("OC", "outside_run", "left", concept="Outside zone",
                       when="If the linebackers bail on the fake"))
    return (option("OC", "outside_run", "left", concept="Outside zone to the boundary"),
            option("OC", "play_action", "right", concept="Play-action crossers",
                   when="If the safeties start to crowd the box"))


def dc_choice(slot: str, facts: list[Fact], own: str, opp: str) -> tuple[dict, dict]:
    blitzes = above(metric(facts, own, "blitz_rate"))
    if slot in ("third_long", "situational_long"):
        if blitzes:
            return (option("DC", front="odd", shell="cover1", pressure="blitz",
                           concept="Man-free with a fire-zone pressure"),
                    option("DC", front="dime_sub", shell="cover4", pressure="sim",
                           concept="Simulated pressure, quarters behind it",
                           when="If they keep a back in to protect"))
        return (option("DC", front="dime_sub", shell="cover4", pressure="sim",
                       concept="Quarters with a simulated pressure"),
                option("DC", front="odd", shell="cover1", pressure="blitz",
                       concept="Man-free robber with a five-man rush",
                       when="If they go empty"))
    if slot == "third_short":
        return (option("DC", front="bear", shell="cover1", pressure="blitz",
                       concept="Bear front, man coverage, run blitz"),
                option("DC", front="even", shell="cover3", pressure="none",
                       concept="Three-deep zone with the safety in the box",
                       when="If they spread out in four-wide"))
    if slot == "red_zone":
        return (option("DC", front="odd", shell="cover1", pressure="sim",
                       concept="Man coverage with a simulated pressure"),
                option("DC", front="even", shell="two_man", pressure="none",
                       concept="Two-man with help over the top",
                       when="If they motion into bunch sets"))
    if slot == "two_minute":
        return (option("DC", front="dime_sub", shell="cover2", pressure="none",
                       concept="Two-deep zone, keep everything in front"),
                option("DC", front="dime_sub", shell="cover4", pressure="sim",
                       concept="Quarters with a late simulated pressure",
                       when="If they work the middle of the field"))
    return (option("DC", front="even", shell="cover3", pressure="none",
                   concept="Three-deep zone with an eight-man front"),
            option("DC", front="odd", shell="cover1", pressure="blitz",
                   concept="Man-free with an edge blitz",
                   when="If they go to heavy personnel"))


def build_call(role: str, slot: str, facts: list[Fact], fallback: list[Fact], own: str,
               opp: str) -> dict[str, Any]:
    cited = ranked([f for f in facts if f["league_value"] is not None])[:3]
    for f in ranked(fallback):
        if len(cited) >= 2:
            break
        if f not in cited:
            cited.append(f)
    primary, alt = (oc_choice if role == "OC" else dc_choice)(slot, facts, own, opp)
    low = [f for f in cited if f["low_sample"]]
    return {
        "role": role, "primary": primary, "alternatives": [alt],
        "rationale": [{"text": sentence(f), "stat_ids": [f["id"]]} for f in cited],
        "confidence": "low" if low else "medium",
        "caveats": [f"{f['label']} comes from a low-sample cell." for f in low],
    }


# ---------------------------------------------------------------- reports and samples

def report_body(fs: Mapping[str, Any]) -> dict[str, Any]:
    ctx = fs["context"]
    role, own, opp = ctx["role"], ctx["team"], ctx["opponent"]
    overall = cell_facts(fs, "overall", "all")
    calls = {}
    for slot in CALL_SLOTS:
        facts = cell_facts(fs, *SLOT_CELLS[slot])
        calls[slot] = build_call(role, slot, facts, overall, own, opp)
    per_slot = {s: ranked([f for f in cell_facts(fs, *SLOT_CELLS[s])
                           if f["league_value"] is not None]) for s in SLOT_CELLS}
    tops = sorted(((s, fl[0]) for s, fl in per_slot.items() if fl),
                  key=lambda sf: (-abs(edge(sf[1])), sf[1]["id"]))[:3]
    keys = [{"title": f"{SLOT_TITLES[s]}: {f['label'].split(': ', 1)[1].split(',')[0]}",
             "detail": sentence(f), "stat_ids": [f["id"]]} for s, f in tops]
    lead_slot, lead = tops[0]
    headline = (f"Build the plan around {SLOT_PHRASES[lead_slot]}, where "
                f"{lead['label'].split(': ', 1)[0]} is {compare(lead)} league average.")
    return {"headline": headline, "keys": keys, "situational_calls": calls}


def make_report(tendencies: list[dict], team: str, opponent: str, role: str,
                stats_as_of: str) -> dict[str, Any]:
    ctx = {"kind": "matchup", **GAME, "team": team, "opponent": opponent, "role": role}
    ctx.pop("week")
    fs = factsheet.build(ctx, tendencies)
    body = report_body(fs)
    errs = validate_report_body(body, fs)
    assert not errs, errs
    report = {"report_version": REPORT_VERSION, "game_id": GAME["game_id"],
              "season": GAME["season"], "week": GAME["week"], "team": team, "opponent": opponent,
              "role": role, "generated_at": GENERATED_AT, "stats_as_of": stats_as_of,
              "provider": PROVIDER, "model": MODEL, "validation_status": "passed",
              "fact_sheet": fs, **body}
    errs = schemas.errors("game_plan_report", report)
    assert not errs, errs
    return report


def make_sample(situation: dict[str, Any]) -> dict[str, Any]:
    rows = load_fact_sheet_rows(situation["season"],
                                [situation["offense"], situation["defense"], "NFL"],
                                FIXTURE_DATA_DIR)
    fs = factsheet.build({"kind": "situation", "situation": situation}, rows)
    own, opp = ((situation["offense"], situation["defense"]) if situation["role"] == "OC"
                else (situation["defense"], situation["offense"]))
    d = fs["derived"]
    slot = ("third_long" if d["down"] >= 3 and d["dist_bucket"] in ("long", "very_long")
            else "third_short" if d["down"] >= 3
            else "red_zone" if d["field_zone"] == "red_zone"
            else "two_minute" if d["time_bucket"] == "two_minute" else "early_down")
    situational = [f for f in fs["facts"] if f["id"].split(".")[3] not in ("overall",)]
    call = build_call(situation["role"], slot, situational, fs["facts"], own, opp)
    errs = validate_call(call, fs, situation)
    assert not errs, errs
    sample = {"situation": fs["context"]["situation"], "fact_sheet": fs, "call": call,
              "generated_at": GENERATED_AT, "model": MODEL}
    assert not schemas.errors("playcaller_sample", sample)
    return sample


def write(path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    stats_as_of = load_manifest(FIXTURE_DATA_DIR)["stats_as_of"]
    tendencies = load_fact_sheet_rows(GAME["season"], None, FIXTURE_DATA_DIR)
    index = []
    for team, opponent, role in REPORTS:
        report = make_report(tendencies, team, opponent, role, stats_as_of)
        rel = report_path(GAME["season"], GAME["week"], GAME["game_id"], team, role)
        write(FIXTURE_REPORTS_DIR / rel, report)
        index.append(index_entry(report, rel))
        print(f"wrote {rel}: {report['headline']}")
    write(FIXTURE_REPORTS_DIR / "index.json", index)
    samples = [make_sample(s) for s in SAMPLE_SITUATIONS]
    write(FIXTURE_REPORTS_DIR / "samples" / "playcaller.json", samples)
    for s in samples:
        p = s["call"]["primary"]
        sit = s["situation"]
        print(f"sample {sit['role']} {sit['offense']}-{sit['defense']}:",
              p["play_family"] or f"{p['front']}/{p['coverage_shell']}/{p['pressure']}")


if __name__ == "__main__":
    main()
