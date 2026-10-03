from __future__ import annotations

import re

from audible_ai import prompts
from audible_ai.config import load_config, with_provider

from .helpers import matchup_fs, situation_fs


def test_situational_prompts_render_completely():
    for role in ("OC", "DC"):
        p = prompts.situational_prompt(situation_fs(role=role))
        for text in (p.system, p.user):
            assert "{{" not in text and "<!--" not in text
        assert "Grounding rules" in p.system
        assert f'"role": "{role}"' in p.user
        assert re.search(r"^- \S+ \| .+ \| \S+ .*\| n=\d+", p.user, re.MULTILINE)


def test_report_and_chat_prompts_render():
    fs = matchup_fs()
    p = prompts.report_prompt(fs)
    assert "{{" not in p.system + p.user and "2026_04_KC_BAL" in p.user
    system = prompts.chat_system({"page": "team", "team": "KC"}, None)
    assert "(no facts available)" in system and "{{" not in system


def test_retry_user_lists_errors():
    out = prompts.retry_user("U", ["a", "b"])
    assert out.startswith("U\n\n") and "- a\n- b" in out


def test_config_loads_and_overrides(tmp_path):
    cfg_file = tmp_path / "config.toml"
    cfg_file.write_text('[ai.live]\nprovider = "ollama"\nmodel = "qwen3:4b-instruct"\n'
                        '[ai.batch]\nprovider = "claude"\nmodel = "qwen3:8b"\n'
                        '[ai.claude]\nmodel = "claude-sonnet-5"\nmax_daily_usd = 1.5\n')
    cfg = load_config(cfg_file)
    assert cfg.live.model == "qwen3:4b-instruct" and cfg.live.base_url == "http://localhost:11434"
    assert cfg.batch.provider == "claude" and cfg.batch.model == "claude-sonnet-5"
    assert cfg.batch.max_daily_usd == 1.5
    assert with_provider(cfg.live, "fake").model == "fake-1"
    assert with_provider(cfg.live, "claude").model == "claude-sonnet-5"
    assert load_config(tmp_path / "missing.toml").batch.model == "qwen3:8b"


def test_principles_by_role_and_digit_free():
    oc = prompts.situational_prompt(situation_fs(role="OC")).system
    dc = prompts.situational_prompt(situation_fs(role="DC")).system
    assert "quarterback sneak" in oc and "stop front" not in oc
    assert "stop front (bear)" in dc and "quarterback sneak" not in dc
    for name in ("_oc_principles", "_dc_principles"):
        assert not re.search(r"\d", prompts._clean(prompts.template(name)))
    assert "stop front" in prompts.report_prompt(matchup_fs("DC")).system
