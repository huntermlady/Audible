"""Validation pipeline (SPEC §12): schema → stat IDs exist → role fields → grounding."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from audible_ai import schemas
from audible_ai.grounding import check_grounding

CALL_SLOTS = ("early_down", "third_short", "third_long", "red_zone", "two_minute")
DC_FIELDS = ("front", "coverage_shell", "pressure")


def _call_texts(call: Mapping[str, Any], where: str) -> Iterator[tuple[str, str]]:
    yield f"{where}primary.concept", call["primary"]["concept"]
    for i, alt in enumerate(call["alternatives"]):
        yield f"{where}alternatives/{i}.concept", alt["concept"]
        yield f"{where}alternatives/{i}.when", alt["when"]
    for i, item in enumerate(call["rationale"]):
        yield f"{where}rationale/{i}.text", item["text"]
    for i, caveat in enumerate(call["caveats"]):
        yield f"{where}caveats/{i}", caveat


def _call_stat_ids(call: Mapping[str, Any], where: str) -> Iterator[tuple[str, str]]:
    for i, item in enumerate(call["rationale"]):
        for sid in item["stat_ids"]:
            yield f"{where}rationale/{i}", sid


def _role_errors(call: Mapping[str, Any], role: str, where: str) -> list[str]:
    errs = []
    if call["role"] != role:
        errs.append(f"{where}role: expected {role!r}, got {call['role']!r}")
    options = [("primary", call["primary"])] + [
        (f"alternatives/{i}", alt) for i, alt in enumerate(call["alternatives"])]
    for name, opt in options:
        if role == "OC":
            if opt["play_family"] is None:
                errs.append(f"{where}{name}.play_family: required for an OC call")
            errs.extend(f"{where}{name}.{f}: must be null for an OC call"
                        for f in DC_FIELDS if opt[f] is not None)
        else:
            if opt["play_family"] is not None:
                errs.append(f"{where}{name}.play_family: must be null for a DC call")
            errs.extend(f"{where}{name}.{f}: required for a DC call"
                        for f in DC_FIELDS if opt[f] is None)
    return errs


def _content_errors(texts: list[tuple[str, str]], stat_ids: list[tuple[str, str]],
                    fs: Mapping[str, Any], situation: Mapping[str, Any] | None) -> list[str]:
    known = {f["id"] for f in fs["facts"]}
    errs = [f"{where}: unknown stat_id {sid!r} (not in the fact sheet)"
            for where, sid in stat_ids if sid not in known]
    for where, text in texts:
        result = check_grounding(text, fs, situation)
        if not result.grounded:
            tokens = ", ".join(repr(u["token"]) for u in result.ungrounded)
            errs.append(f"{where}: ungrounded number(s) {tokens}; use only numbers from the fact "
                        "sheet display values or the situation")
    return errs


def _context_role(fs: Mapping[str, Any]) -> str:
    ctx = fs["context"]
    if ctx["kind"] == "situation":
        return ctx["situation"]["role"]
    if ctx["kind"] == "matchup":
        return ctx["role"]
    raise ValueError("structured calls need a situation or matchup fact sheet")


def validate_call(raw: Any, fs: Mapping[str, Any],
                  situation: Mapping[str, Any] | None = None) -> list[str]:
    """Errors for a CoordinatorCall (empty list = valid)."""
    errs = schemas.errors("coordinator_call", raw)
    if errs:
        return errs
    where = ""
    errs = _role_errors(raw, _context_role(fs), where)
    errs += _content_errors(list(_call_texts(raw, where)), list(_call_stat_ids(raw, where)),
                            fs, situation)
    return errs


def validate_report_body(raw: Any, fs: Mapping[str, Any]) -> list[str]:
    """Errors for the model-written part of a GamePlanReport (headline, keys, situational_calls)."""
    errs = schemas.report_body_errors(raw)
    if errs:
        return errs
    role = _context_role(fs)
    texts: list[tuple[str, str]] = [("headline", raw["headline"])]
    stat_ids: list[tuple[str, str]] = []
    for i, key in enumerate(raw["keys"]):
        texts += [(f"keys/{i}.title", key["title"]), (f"keys/{i}.detail", key["detail"])]
        stat_ids += [(f"keys/{i}", sid) for sid in key["stat_ids"]]
    for slot in CALL_SLOTS:
        call = raw["situational_calls"][slot]
        where = f"situational_calls/{slot}/"
        errs += _role_errors(call, role, where)
        texts += list(_call_texts(call, where))
        stat_ids += list(_call_stat_ids(call, where))
    return errs + _content_errors(texts, stat_ids, fs, None)
