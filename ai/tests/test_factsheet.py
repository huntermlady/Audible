from __future__ import annotations

from typing import Any

import pytest

from audible_ai import factsheet, schemas
from audible_ai.factsheet import (
    build,
    dist_bucket,
    dumps,
    field_zone,
    format_value,
    round4,
    score_state,
    time_bucket,
)

from .conftest import golden_names, load_golden


def test_there_are_enough_goldens():
    names = golden_names()
    assert len(names) >= 6
    assert any(n.startswith("situation_") for n in names)
    assert any(n.startswith("matchup_") for n in names)


@pytest.mark.parametrize("name", golden_names())
def test_golden_byte_identical(name):
    g, expected = load_golden(name)
    assert dumps(build(g["context"], g["tendencies"])) + "\n" == expected


@pytest.mark.parametrize("name", golden_names())
def test_golden_is_schema_valid(name):
    g, _ = load_golden(name)
    assert schemas.errors("fact_sheet", build(g["context"], g["tendencies"])) == []


@pytest.mark.parametrize(("d", "want"), [
    (1, "short"), (3, "short"), (4, "medium"), (6, "medium"),
    (7, "long"), (10, "long"), (11, "very_long"), (99, "very_long")])
def test_dist_bucket(d, want):
    assert dist_bucket(d) == want


@pytest.mark.parametrize(("y", "want"), [
    (1, "red_zone"), (20, "red_zone"), (21, "opp_territory"), (49, "opp_territory"),
    (50, "own_territory"), (89, "own_territory"), (90, "backed_up"), (99, "backed_up")])
def test_field_zone(y, want):
    assert field_zone(y) == want


@pytest.mark.parametrize(("s", "want"), [
    (-20, "trail_9plus"), (-9, "trail_9plus"), (-8, "trail_1_8"), (-1, "trail_1_8"),
    (0, "tied"), (1, "lead_1_8"), (8, "lead_1_8"), (9, "lead_9plus")])
def test_score_state(s, want):
    assert score_state(s) == want


@pytest.mark.parametrize(("q", "c", "want"), [(2, 120, "two_minute"), (2, 121, "normal"),
                                              (4, 120, "two_minute"), (4, 121, "fourth_quarter"),
                                              (5, 60, "fourth_quarter"), (1, 30, "normal"),
                                              (3, 100, "normal")])
def test_time_bucket(q, c, want):
    assert time_bucket(q, c) == want


@pytest.mark.parametrize(("unit", "raw", "want"), [
    ("rate", 0.41, "41%"), ("rate", 0.285, "29%"), ("rate", 0.2849, "28%"), ("rate", 0.0, "0%"),
    ("rate", 1.0, "100%"), ("rate", -0.034, "-3%"), ("rate", -0.004, "0%"),
    ("rate", 0.00499, "1%"),  # display derives from the 4-dp value (0.005)
    ("rate", 0.005, "1%"),
    ("epa", 0.12, "+0.12"), ("epa", -0.05, "-0.05"), ("epa", 0.0, "0.00"),
    ("epa", -0.0041, "0.00"), ("epa", 0.005, "+0.01"), ("epa", -0.005, "-0.01"),
    ("epa", 1.234, "+1.23"), ("epa", -0.1257, "-0.13"),
    ("yards", 8.44, "8.4"), ("yards", 8.45, "8.5"), ("yards", 0.0, "0.0"), ("yards", -1.25, "-1.3"),
    ("yards", -0.04, "0.0"), ("yards", 12.0, "12.0"),
    ("count", 58, "58"), ("count", 0, "0"),
])
def test_format_value(unit, raw, want):
    assert format_value(unit, raw) == want


def test_round4_integral_and_negative_zero():
    assert round4(0.0) == 0 and isinstance(round4(0.0), int)
    assert round4(-0.00001) == 0 and isinstance(round4(-0.00001), int)
    assert round4(1.0) == 1 and isinstance(round4(1.0), int)
    assert round4(0.123456) == 0.1235
    assert round4(-0.12345) == -0.1235  # half away from zero (on the IEEE product)


def _row(team, side, grouping, cell_key, plays, low, season: int = 2026, **metrics):
    base = {"season": season, "team": team, "side": side, "grouping": grouping, "down": None,
            "dist_bucket": None, "field_zone": None, "score_state": None, "time_bucket": None,
            "cell_key": cell_key, "plays": plays, "low_sample": low}
    base.update(metrics)
    return base


def test_low_sample_fallback_and_dedupe(kc_bal_situation):
    rows = [
        _row("KC", "off", "overall", "all", 300, False, pass_rate=0.6),
        _row("KC", "off", "down_dist", "d3-long", 12, True, pass_rate=0.9, down=3,
             dist_bucket="long"),
        _row("KC", "off", "down_dist_zone", "d3-long-opp_territory", 5, True, pass_rate=1.0,
             down=3, dist_bucket="long", field_zone="opp_territory"),
    ]
    fs = build({"kind": "situation", "situation": kc_bal_situation}, rows)
    ids = [f["id"] for f in fs["facts"]]
    # Every narrow candidate is low_sample → the situational slot falls back to overall; the
    # overall slot then emits nothing new for pass_rate (deduped).
    assert ids == ["KC.off.2026.overall.all.pass_rate"]
    assert fs["facts"][0]["league_value"] is None and fs["facts"][0]["league_display"] is None


def test_required_slot_keeps_broadest_low_sample_row():
    rows = [_row("KC", "off", "zone", "red_zone", 8, True, pass_rate=0.5, field_zone="red_zone")]
    ctx = {"kind": "matchup", "game_id": "2026_04_KC_BAL", "season": 2026, "team": "KC",
           "opponent": "BAL", "role": "OC"}
    fs = build(ctx, rows)
    assert [(f["id"], f["low_sample"], f["n"]) for f in fs["facts"]] == [
        ("KC.off.2026.zone.red_zone.pass_rate", True, 8)]


def test_optional_slot_omitted_when_low_sample(kc_bal_situation):
    rows = [_row("KC", "off", "zone", "opp_territory", 8, True, pass_rate=0.5,
                 field_zone="opp_territory")]
    fs = build({"kind": "situation", "situation": kc_bal_situation}, rows)
    assert fs["facts"] == []


def test_inputs_and_context_normalization(kc_bal_situation):
    shuffled = dict(reversed(list(kc_bal_situation.items())))
    ctx = {"kind": "situation", "situation": shuffled}
    assert factsheet.inputs(ctx) == {"season": 2026, "seasons": [2026, 2025],
                                     "teams": ["KC", "BAL", "NFL"]}
    dc = {"kind": "situation", "situation": {**kc_bal_situation, "role": "DC"}}
    assert factsheet.inputs(dc)["teams"] == ["BAL", "KC", "NFL"]
    fs = build(ctx, [])
    assert list(fs["context"]["situation"]) == list(kc_bal_situation)
    assert list(fs) == ["fact_sheet_version", "context", "derived", "facts"]
    team = {"kind": "team", "season": 2026, "team": "KC"}
    assert factsheet.inputs(team) == {"season": 2026, "seasons": [2026, 2025],
                                      "teams": ["KC", "NFL"]}
    assert build(team, [])["derived"] is None


def test_max_facts_cap(monkeypatch, kc_bal_situation):
    many = tuple(factsheet.METRIC_LABELS)
    monkeypatch.setitem(factsheet.SITUATION_METRICS, "overall", {"off": many, "def": many})
    metrics: dict[str, float] = {m: 0.5 for m in many if m != "plays"}
    rows = [_row(t, s, "overall", "all", 500, False, 2026, **metrics)
            for t, s in (("KC", "off"), ("BAL", "def"))]
    fs = build({"kind": "situation", "situation": kc_bal_situation}, rows)
    assert len(fs["facts"]) == 40
    assert fs["facts"][0]["id"].startswith("KC.off.")


def test_labels_have_no_digits_except_down_ordinals():
    import re

    for name in golden_names():
        g, _ = load_golden(name)
        for f in build(g["context"], g["tendencies"])["facts"]:
            stripped = re.sub(r"\b[1-4](st|nd|rd|th)\b", "", f["label"])
            season = f["id"].split(".")[2]
            if f" ({season})" in stripped:  # prior-season fallback suffix
                assert int(season) == factsheet.context_season(g["context"]) - 1
                stripped = stripped.replace(f" ({season})", "")
            assert not re.search(r"\d", stripped.split(":", 1)[1]), f["label"]


def test_prior_season_fallback_order(kc_bal_situation):
    # 3rd & 7, Q4 1:50, down 4 → ddst "d3-long-trail_1_8-two_minute", ddz "d3-long-opp_territory".
    dd: dict[str, Any] = {"down": 3, "dist_bucket": "long"}
    rows = [
        _row("KC", "off", "down_dist_score_time", "d3-long-trail_1_8-two_minute", 5, True,
             pass_rate=0.9, **dd),
        _row("KC", "off", "down_dist_score_time", "d3-long-trail_1_8-two_minute", 9, True,
             season=2025, pass_rate=0.8, **dd),  # prior season also low → not used
        _row("KC", "off", "down_dist_zone", "d3-long-opp_territory", 12, True, pass_rate=0.7,
             field_zone="opp_territory", **dd),
        _row("KC", "off", "down_dist_zone", "d3-long-opp_territory", 40, False, season=2025,
             pass_rate=0.66, field_zone="opp_territory", **dd),
        # Broader and not low_sample, but the prior-season narrow cell wins first.
        _row("KC", "off", "down_dist", "d3-long", 30, False, pass_rate=0.6, **dd),
        _row("NFL", "off", "down_dist_zone", "d3-long-opp_territory", 900, False, season=2025,
             pass_rate=0.61, field_zone="opp_territory", **dd),
    ]
    fs = build({"kind": "situation", "situation": kc_bal_situation}, rows)
    f = fs["facts"][0]
    assert f["id"] == "KC.off.2025.down_dist_zone.d3-long-opp_territory.pass_rate"
    assert f["label"] == "KC offense: pass rate, 3rd & long, opponent territory (2025)"
    assert (f["value"], f["n"], f["league_display"]) == (0.66, 40, "61%")


def test_overall_never_falls_back_to_prior_season(kc_bal_situation):
    rows = [_row("KC", "off", "overall", "all", 10, True, pass_rate=0.5),
            _row("KC", "off", "overall", "all", 900, False, season=2025, pass_rate=0.55)]
    fs = build({"kind": "situation", "situation": kc_bal_situation}, rows)
    assert [(f["id"], f["low_sample"]) for f in fs["facts"]] == [
        ("KC.off.2026.overall.all.pass_rate", True)]
