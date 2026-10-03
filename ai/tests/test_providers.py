from __future__ import annotations

import json
from datetime import date
from types import SimpleNamespace

import httpx
import pytest

from audible_ai.providers.base import BudgetExceeded, ProviderError, ProviderUnavailable
from audible_ai.providers.claude import (
    ClaudeProvider,
    SpendTracker,
    api_key_from_env,
    claude_schema,
    cost_usd,
)
from audible_ai.providers.ollama import OllamaProvider


def _ollama(handler) -> OllamaProvider:
    return OllamaProvider("qwen3:4b", "http://ollama.test",
                          client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_ollama_generate_json_streams_and_parses():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        lines = [{"message": {"content": '{"a":'}, "done": False},
                 {"message": {"content": " 1}"}, "done": False},
                 {"message": {"content": ""}, "done": True, "prompt_eval_count": 12,
                  "eval_count": 3}]
        return httpx.Response(200, content="\n".join(json.dumps(x) for x in lines))

    res = _ollama(handler).generate_json("sys", "usr", {"type": "object"})
    assert res.parsed == {"a": 1} and res.raw_text == '{"a": 1}'
    assert res.prompt_tokens == 12 and res.output_tokens == 3 and res.first_token_ms is not None
    assert seen["format"] == {"type": "object"} and seen["stream"] is True
    assert seen["think"] is False and seen["messages"][0] == {"role": "system", "content": "sys"}


def test_ollama_errors():
    down = _ollama(lambda r: (_ for _ in ()).throw(httpx.ConnectError("refused")))
    with pytest.raises(ProviderUnavailable):
        down.generate_json("s", "u", {})
    assert down.health() == (False, [])
    http500 = _ollama(lambda r: httpx.Response(500, text="boom"))
    with pytest.raises(ProviderError):
        http500.generate_json("s", "u", {})
    in_stream = _ollama(lambda r: httpx.Response(200, text=json.dumps({"error": "no model"})))
    with pytest.raises(ProviderError, match="no model"):
        in_stream.generate_json("s", "u", {})


def test_ollama_health_lists_models():
    p = _ollama(lambda r: httpx.Response(200, json={"models": [{"name": "qwen3:8b"}]}))
    assert p.health() == (True, ["qwen3:8b"])


def test_spend_tracker(tmp_path):
    t = SpendTracker(1.0, tmp_path / "spend.json", today=lambda: date(2026, 9, 25))
    t.check()
    t.record(0.6)
    t.record(0.5)
    assert t.spent_today() == pytest.approx(1.1)
    with pytest.raises(BudgetExceeded):
        t.check()
    tomorrow = SpendTracker(1.0, tmp_path / "spend.json", today=lambda: date(2026, 9, 26))
    tomorrow.check()


def test_cost_and_schema_sanitizer():
    assert cost_usd("claude-sonnet-5", 1_000_000, 100_000) == pytest.approx(3.0)
    s = {"type": "object", "properties": {"minItems": {"type": "array", "minItems": 1}},
         "required": ["minItems"], "additionalProperties": False}
    assert claude_schema(s) == {"type": "object", "properties": {"minItems": {"type": "array"}},
                                "required": ["minItems"], "additionalProperties": False}


class _FakeStream:
    def __init__(self, chunks, usage):
        self.text_stream = iter(chunks)
        self._final = SimpleNamespace(usage=usage, stop_reason="end_turn")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self._final


class _FakeClient:
    def __init__(self):
        self.kwargs: dict | None = None
        self.messages = self

    def with_options(self, **_):
        return self

    def stream(self, **kwargs):
        self.kwargs = kwargs
        usage = SimpleNamespace(input_tokens=1000, output_tokens=200,
                                cache_creation_input_tokens=0, cache_read_input_tokens=0)
        return _FakeStream(['{"ok": ', "true}"], usage)


def test_claude_generate_json_records_spend(tmp_path):
    client = _FakeClient()
    tracker = SpendTracker(2.0, tmp_path / "spend.json")
    p = ClaudeProvider("claude-sonnet-5", 2.0, spend=tracker, client=client)
    res = p.generate_json("sys", "usr", {"type": "object", "properties": {}, "minProperties": 1})
    assert res.parsed == {"ok": True} and res.prompt_tokens == 1000 and res.output_tokens == 200
    assert tracker.spent_today() == pytest.approx(cost_usd("claude-sonnet-5", 1000, 200))
    kwargs = client.kwargs
    assert kwargs is not None
    assert kwargs["output_config"]["format"]["type"] == "json_schema"
    assert "temperature" not in kwargs
    tracker.record(5.0)
    with pytest.raises(BudgetExceeded):
        p.generate_json("sys", "usr", {})


def test_api_key_from_dotenv(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text('# comment\nOTHER=1\nexport ANTHROPIC_API_KEY="sk-test"\n')
    assert api_key_from_env(env) == "sk-test"
    assert api_key_from_env(tmp_path / "missing") is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")
    assert api_key_from_env(env) == "sk-env"


def test_cloud_provider_waits_out_rate_limits_then_raises():
    from audible_ai.providers.ollama import RateLimited

    calls = {"n": 0}
    ok = [{"message": {"content": '{"a": 1}'}, "done": False},
          {"message": {"content": ""}, "done": True, "prompt_eval_count": 7, "eval_count": 2}]

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] <= 2:
            return httpx.Response(429, headers={"Retry-After": "12"},
                                  json={"error": "rate_limited"})
        return httpx.Response(200, content="\n".join(json.dumps(x) for x in ok))

    slept: list[float] = []
    p = OllamaProvider("qwen3-30b-a3b", "http://worker.test", name="cloud",
                       client=httpx.Client(transport=httpx.MockTransport(handler)),
                       sleep=slept.append)
    assert p.name == "cloud"
    assert p.generate_json("s", "u", {}).parsed == {"a": 1}
    assert slept == [12.0, 12.0]

    always = OllamaProvider("m", "http://worker.test", name="cloud", max_rate_waits=1,
                            client=httpx.Client(transport=httpx.MockTransport(
                                lambda r: httpx.Response(429, json={}))),
                            sleep=lambda s: None)
    with pytest.raises(RateLimited):
        always.generate_json("s", "u", {})
