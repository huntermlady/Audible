"""Regenerate shared/factsheet/goldens/*.json inputs from shared/fixtures (SPEC §10).

    uv run python ai/scripts/make_goldens.py              # inputs only
    uv run python ai/scripts/make_goldens.py --expected   # also rewrite *.expected.json

Review the expected-output diff before committing it.
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from audible_ai import factsheet
from audible_ai.data import load_fixture_tendencies
from audible_contracts.paths import SHARED_DIR

GOLDENS_DIR = SHARED_DIR / "factsheet" / "goldens"


def situation(role: str, offense: str, defense: str, season: int, down: int, distance: int,
              yardline_100: int, quarter: int, clock_seconds: int, score_diff: int,
              timeouts_offense: int = 2, timeouts_defense: int = 2) -> dict[str, Any]:
    # Deliberately not in schema key order: the builder must normalize it.
    return {"kind": "situation", "situation": {
        "offense": offense, "defense": defense, "role": role, "season": season, "down": down,
        "distance": distance, "yardline_100": yardline_100, "quarter": quarter,
        "clock_seconds": clock_seconds, "score_diff": score_diff,
        "timeouts_offense": timeouts_offense, "timeouts_defense": timeouts_defense}}


def matchup(game_id: str, season: int, team: str, opponent: str, role: str) -> dict[str, Any]:
    return {"kind": "matchup", "game_id": game_id, "season": season, "team": team,
            "opponent": opponent, "role": role}


GOLDENS: list[tuple[str, str, dict[str, Any]]] = [
    ("situation_oc_third_long_two_minute",
     "OC, 3rd & 7 at the opponent 35, Q4 1:50, trailing by 4 (two-minute).",
     situation("OC", "KC", "BAL", 2026, 3, 7, 35, 4, 110, -4)),
    ("situation_dc_red_zone",
     "DC, 1st & 8 at the 8 (red zone orders down_dist_zone before down_dist_score_time).",
     situation("DC", "KC", "BAL", 2026, 1, 8, 8, 2, 400, 3, 3, 1)),
    ("situation_oc_backed_up_2025_nulls",
     "OC in 2025 (no charting data: blitz/pressure/man/zone are null and omitted), backed up. "
     "The NFL zone row is removed, so those facts have null league values.",
     situation("OC", "DAL", "MIA", 2025, 2, 4, 95, 1, 700, 0)),
    ("situation_dc_fourth_down_low_sample_ot",
     "DC, 4th & 1 in OT early in a season: narrow cells are low_sample, falls back broader; "
     "optional low-sample slots are omitted.",
     situation("DC", "BUF", "SF", 2026, 4, 1, 52, 5, 400, 0, 1, 1)),
    ("situation_oc_very_long_missing_cells",
     "OC, 2nd & 15 leading by 10 in the Q2 two-minute: some candidate rows do not exist.",
     situation("OC", "SEA", "GB", 2026, 2, 15, 70, 2, 30, 10)),
    ("matchup_oc_kc_bal_2026",
     "Matchup, KC offense vs BAL defense (two_minute slot is low_sample and kept).",
     matchup("2026_04_KC_BAL", 2026, "KC", "BAL", "OC")),
    ("matchup_dc_dal_mia_2025",
     "Matchup, DAL defense vs MIA offense in 2025 (null optional metrics omitted).",
     matchup("2025_12_DAL_MIA", 2025, "DAL", "MIA", "DC")),
    ("matchup_dc_bal_kc_2026",
     "Matchup, BAL defense vs KC offense (2026 charting data present).",
     matchup("2026_04_KC_BAL", 2026, "BAL", "KC", "DC")),
    ("matchup_oc_kc_bal_2026_no_prior_season",
     "Matchup KC OC vs BAL with no prior-season rows: low-sample required slots keep the "
     "context-season row, flagged low_sample.",
     matchup("2026_04_KC_BAL", 2026, "KC", "BAL", "OC")),
    ("team_kc_2026",
     "Team context (chat on a team page): KC offense then KC defense, matchup slots.",
     {"kind": "team", "season": 2026, "team": "KC"}),
]


DROP_LEAGUE_ZONE = {"situation_oc_backed_up_2025_nulls"}
NO_PRIOR_SEASON = {"matchup_oc_kc_bal_2026_no_prior_season"}


def candidate_cells(ctx: dict[str, Any]) -> set[tuple[str, str]]:
    return {c for _n, _r, cands, _m in factsheet._slots(factsheet.normalize_context(ctx))
            for c in cands}


def golden_input(name: str, description: str, ctx: dict[str, Any]) -> dict[str, Any]:
    spec = factsheet.inputs(factsheet.normalize_context(ctx))
    season, teams = spec["season"], spec["teams"]
    cells = candidate_cells(ctx)
    rows = [r for s in spec["seasons"] for r in load_fixture_tendencies(s, teams)
            if (r["grouping"], r["cell_key"]) in cells]
    if name in NO_PRIOR_SEASON:
        rows = [r for r in rows if r["season"] == season]
    if name in DROP_LEAGUE_ZONE:
        rows = [r for r in rows if not (r["team"] == "NFL" and r["grouping"] == "zone")]
    rows.sort(key=lambda r: (r["team"], r["side"], r["grouping"], r["cell_key"]))
    # Distractors the builder must ignore: other season, other team, other cell.
    other_season = season + 1  # a later season must be ignored (none exists for 2026 contexts)
    distractors = [r for r in load_fixture_tendencies(other_season, teams[:1])
                   if (r["grouping"], r["cell_key"]) in cells][:1]
    distractors += [r for r in load_fixture_tendencies(season, ["NYJ"])
                    if (r["grouping"], r["cell_key"]) == ("overall", "all")][:1]
    distractors += [r for r in load_fixture_tendencies(season, teams[:1])
                    if r["grouping"] == "down_dist"
                    and (r["grouping"], r["cell_key"]) not in cells][:1]
    # A later duplicate of an address that is used: the first row in input order must win.
    dup = dict(next(r for r in rows if r["grouping"] == "overall" and r["team"] != "NFL"))
    dup["epa_per_play"] = 9.9999
    return {"name": name, "description": description, "context": ctx,
            "tendencies": rows + distractors + [dup]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", action="store_true", help="rewrite expected outputs too")
    args = parser.parse_args()
    GOLDENS_DIR.mkdir(parents=True, exist_ok=True)
    for name, description, ctx in GOLDENS:
        g = golden_input(name, description, ctx)
        (GOLDENS_DIR / f"{name}.json").write_text(json.dumps(g, indent=1) + "\n")
        if args.expected:
            fs = factsheet.build(g["context"], g["tendencies"])
            (GOLDENS_DIR / f"{name}.expected.json").write_text(factsheet.dumps(fs) + "\n")
        print(f"{name}: {len(g['tendencies'])} rows")


if __name__ == "__main__":
    main()
