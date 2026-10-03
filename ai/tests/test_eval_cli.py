from __future__ import annotations

import json
import logging

from audible_ai import cli
from audible_ai import eval as ev
from audible_ai.config import AIConfig, StageConfig
from audible_ai.providers.fake import FakeProvider


def test_acceptable():
    oc = {"situation": {"role": "OC"}, "acceptable_play_families": ["quick_pass"],
          "unacceptable_play_families": ["sneak"]}
    call = {"primary": {"play_family": "quick_pass"}}
    assert ev.acceptable(oc, call)
    assert not ev.acceptable(oc, {"primary": {"play_family": "sneak"}})
    dc = {"situation": {"role": "DC"}, "acceptable_pressures": None,
          "unacceptable_pressures": ["none"], "acceptable_coverage_shells": ["cover1"],
          "acceptable_fronts": ["bear", "odd"]}
    assert ev.acceptable(dc, {"primary": {"pressure": "blitz", "coverage_shell": "cover1",
                                          "front": "odd"}})
    assert not ev.acceptable(dc, {"primary": {"pressure": "none", "coverage_shell": "cover1",
                                              "front": "odd"}})
    assert not ev.acceptable(dc, None)


def test_percentile():
    assert ev.percentile([], 50) is None
    assert ev.percentile([5, 1, 3, 2, 4], 50) == 3
    assert ev.percentile(list(range(1, 21)), 95) == 19


def test_run_eval_with_fake_writes_scorecard(tmp_path):
    scenarios = ev.load_scenarios()
    assert len(scenarios) == 12
    stages = [StageConfig("live", "fake", "fake-1"), StageConfig("batch", "fake", "fake-1")]
    result, path = ev.run_eval([(s, FakeProvider()) for s in stages], scenarios,
                               results_dir=tmp_path)
    assert path.exists() and json.loads(path.read_text()) == result
    for cfg in result["configs"]:
        card = cfg["scorecard"]
        assert card["scenarios"] == 12
        assert card["json_valid_pct"] == 100.0 and card["grounded_pct"] == 100.0
        assert card["total_ms_p50"] is not None
    assert "json%" in ev.format_scorecard(result)


def test_cli_reports_exits_cleanly_when_ollama_down(monkeypatch, caplog, tmp_path):
    stage = StageConfig("batch", "ollama", "qwen3:8b", base_url="http://127.0.0.1:9")
    monkeypatch.setattr(cli, "load_config", lambda: AIConfig(live=stage, batch=stage))
    with caplog.at_level(logging.WARNING):
        code = cli.main(["reports", "--week", "4", "--out", str(tmp_path)])
    assert code == 0
    assert "Ollama is not running at http://127.0.0.1:9" in caplog.text
    assert not any(tmp_path.iterdir())


def test_cloud_stage_config_and_neuron_estimate():
    from audible_ai.config import with_provider
    from audible_ai.providers import make_provider

    base = StageConfig("live", "ollama", "qwen3:4b-instruct")
    cloud = with_provider(base, "cloud", "http://localhost:8788/")
    assert (cloud.provider, cloud.model, cloud.base_url) == ("cloud", "auto", "http://localhost:8788")
    p = make_provider(cloud)
    assert p.name == "cloud"
    rows = [{"json_valid": True, "grounded": True, "acceptable_family": True, "first_token_ms": 10,
             "total_ms": 20, "attempts": 1, "prompt_tokens": 1_000_000, "output_tokens": 100_000,
             "defensible": None}]
    card = ev.scorecard(rows, "live", "qwen3-30b-a3b")
    assert card["est_neurons"] == round(4_627 + 3_045.5, 1)
    assert ev.scorecard(rows, "live")["est_neurons"] is None
