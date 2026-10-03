from __future__ import annotations

import copy

from audible_ai import schemas
from audible_ai.validate import validate_call, validate_report_body

from .helpers import matchup_fs, situation_fs, valid_call


def test_valid_oc_call_passes():
    fs = situation_fs()
    assert validate_call(valid_call(fs), fs) == []


def test_valid_dc_call_passes():
    fs = situation_fs(role="DC")
    assert validate_call(valid_call(fs, "DC"), fs) == []


def test_schema_error_short_circuits():
    fs = situation_fs()
    call = valid_call(fs)
    call["rationale"] = call["rationale"][:1]
    errs = validate_call(call, fs)
    assert errs and "rationale" in errs[0]


def test_unknown_stat_id():
    fs = situation_fs()
    call = valid_call(fs)
    call["rationale"][0]["stat_ids"] = ["KC.off.2025.overall.all.blitz_rate"]
    assert any("unknown stat_id" in e for e in validate_call(call, fs))


def test_ungrounded_number_in_caveat():
    fs = situation_fs()
    call = valid_call(fs)
    call["caveats"] = ["They convert 97.3% of these."]
    errs = validate_call(call, fs)
    assert len(errs) == 1 and "caveats/0" in errs[0] and "'97.3%'" in errs[0]


def test_role_mismatch_and_dc_fields_on_oc():
    fs = situation_fs()
    call = valid_call(fs, "DC")
    errs = validate_call(call, fs)
    assert any(e.startswith("role:") for e in errs)
    assert any("play_family: required for an OC call" in e for e in errs)


def test_situation_numbers_are_grounded():
    fs = situation_fs()
    call = valid_call(fs)
    call["primary"]["concept"] = "Beat the blitz on 3rd & 7 at the 35 with 1:50 left"
    assert validate_call(call, fs) == []


def _report_body(fs, role="OC"):
    call = valid_call(fs, role)
    fact_ids = [f["id"] for f in fs["facts"]]
    return {
        "headline": "Attack the blitz with quick answers.",
        "keys": [{"title": f"Key {'ABC'[i]}", "detail": "Stay ahead of the chains.",
                  "stat_ids": [fact_ids[i]]} for i in range(3)],
        "situational_calls": {s: copy.deepcopy(call) for s in
                              ("early_down", "third_short", "third_long", "red_zone",
                               "two_minute")},
    }


def test_report_body_valid_and_invalid():
    fs = matchup_fs()
    body = _report_body(fs)
    assert validate_report_body(body, fs) == []
    body["keys"][1]["detail"] = "They allow 4.7 yards per carry."
    body["situational_calls"]["red_zone"]["role"] = "DC"
    errs = validate_report_body(body, fs)
    assert any("keys/1.detail" in e for e in errs)
    assert any(e.startswith("situational_calls/red_zone/role") for e in errs)


def test_model_schema_is_self_contained_with_stat_id_enum():
    fs = situation_fs()
    ids = [f["id"] for f in fs["facts"]]
    for kind in ("call", "report"):
        s = schemas.model_schema(kind, ids)
        text = str(s)
        assert "$ref" not in text and "pattern" not in text
    call_schema = schemas.model_schema("call", ids)
    items = call_schema["properties"]["rationale"]["items"]["properties"]["stat_ids"]["items"]
    assert items == {"type": "string", "enum": ids}
    report = schemas.model_schema("report", ids)
    # Property names that collide with keywords survive the keyword stripping.
    key_props = report["properties"]["keys"]["items"]["properties"]
    assert set(key_props) == {"title", "detail", "stat_ids"}


def test_model_schema_pins_role_fields():
    ids = ["KC.off.2026.overall.all.pass_rate"]
    oc = schemas.model_schema("call", ids, "OC")
    opt = oc["properties"]["primary"]["properties"]
    assert opt["front"] == opt["coverage_shell"] == opt["pressure"] == {"type": "null"}
    assert opt["play_family"]["type"] == "string" and None not in opt["play_family"]["enum"]
    assert oc["properties"]["role"] == {"type": "string", "enum": ["OC"]}
    dc = schemas.model_schema("report", ids, "DC")
    call = dc["properties"]["situational_calls"]["properties"]["early_down"]["properties"]
    alt = call["alternatives"]["items"]["properties"]
    assert alt["play_family"] == alt["direction"] == {"type": "null"}
    assert alt["pressure"]["enum"] == ["none", "sim", "blitz"]
    assert "when" in alt  # other properties untouched
    assert call["role"] == {"type": "string", "enum": ["DC"]}
