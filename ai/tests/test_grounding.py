from __future__ import annotations

import json

import pytest

from audible_ai.grounding import check_grounding

from .conftest import GROUNDING_CASES

DATA = json.loads(GROUNDING_CASES.read_text())


def test_enough_cases():
    assert len(DATA["cases"]) >= 30


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda c: c["id"])
def test_grounding_case(case):
    fs = DATA["fact_sheets"][case["fact_sheet"]] if case["fact_sheet"] else None
    result = check_grounding(case["text"], fs, case["situation"])
    assert [u["token"] for u in result.ungrounded] == case["expected_ungrounded"]
    assert result.grounded is case["expected_grounded"]
    for u in result.ungrounded:
        assert case["text"][u["start"]:u["end"]] == u["token"]
