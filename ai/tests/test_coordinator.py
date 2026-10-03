from __future__ import annotations

import pytest

from audible_ai.coordinator import run_call, run_report
from audible_ai.providers.base import ProviderError, ProviderUnavailable
from audible_ai.providers.fake import FakeProvider

from .helpers import ScriptedProvider, matchup_fs, result, situation_fs, valid_call


def test_first_attempt_ok():
    fs = situation_fs()
    p = ScriptedProvider([result(valid_call(fs))])
    out = run_call(fs, p)
    assert out.ok and out.attempts == 1 and out.first_token_ms == 2
    assert len(p.requests) == 1


def test_retry_with_errors_appended_then_ok():
    fs = situation_fs()
    bad = valid_call(fs)
    bad["caveats"] = ["They convert 97.3% of these."]
    p = ScriptedProvider([result(bad), result(valid_call(fs))])
    out = run_call(fs, p)
    assert out.ok and out.attempts == 2
    assert out.first_attempt_errors and "97.3%" in out.first_attempt_errors[0]
    retry_user = p.requests[1]["user"]
    assert retry_user.startswith(p.requests[0]["user"])
    assert "failed validation" in retry_user and "97.3%" in retry_user


def test_two_failures_is_final():
    fs = situation_fs()
    p = ScriptedProvider([result(None, "not json"), result(None, "still not json")])
    out = run_call(fs, p)
    assert not out.ok and out.attempts == 2
    assert out.errors == ["response is not a JSON object"]


def test_provider_error_counts_as_attempt():
    fs = situation_fs()
    p = ScriptedProvider([ProviderError("HTTP 500"), result(valid_call(fs))])
    out = run_call(fs, p)
    assert out.ok and out.attempts == 2


def test_unavailable_propagates():
    fs = situation_fs()
    with pytest.raises(ProviderUnavailable):
        run_call(fs, ScriptedProvider([ProviderUnavailable("down")]))


def test_fake_provider_is_valid_for_calls_and_reports():
    for role in ("OC", "DC"):
        assert run_call(situation_fs(role=role), FakeProvider()).ok
        assert run_report(matchup_fs(role), FakeProvider()).ok


def test_fake_fail_first_exercises_retry():
    out = run_call(situation_fs(), FakeProvider(fail_first=True))
    assert out.ok and out.attempts == 2
    out = run_report(matchup_fs(), FakeProvider(fail_first=True))
    assert out.ok and out.attempts == 2
