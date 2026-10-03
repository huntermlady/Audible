"""config.toml loader (BUILD_PLAN §5.4). Switching a stage to Claude = `provider = "claude"`."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from audible_contracts.paths import REPO_ROOT

CONFIG_PATH = REPO_ROOT / "config.toml"
DEFAULT_BASE_URL = "http://localhost:11434"


@dataclass(frozen=True)
class StageConfig:
    stage: str
    provider: str
    model: str
    base_url: str = DEFAULT_BASE_URL
    think: bool = False
    max_daily_usd: float = 2.0
    fallback_model: str | None = None
    claude_model: str = "claude-sonnet-5"


@dataclass(frozen=True)
class AIConfig:
    live: StageConfig
    batch: StageConfig

    def stage(self, name: str) -> StageConfig:
        return {"live": self.live, "batch": self.batch}[name]


def _stage(name: str, ai: dict[str, Any], default_model: str) -> StageConfig:
    raw = ai.get(name, {})
    claude = ai.get("claude", {})
    provider = raw.get("provider", "ollama")
    base_url = raw.get("base_url", ai.get("live", {}).get("base_url", DEFAULT_BASE_URL))
    model = raw.get("model", default_model)
    if provider == "claude":
        model = claude.get("model", "claude-sonnet-5")
    if provider == "cloud":
        # The Worker's URL lives in [ai.cloud].worker_url; its default model is used ("auto").
        base_url = raw.get("base_url") or ai.get("cloud", {}).get("worker_url", "")
        model = "auto"
    return StageConfig(
        stage=name,
        provider=provider,
        model=model,
        base_url=base_url,
        think=bool(raw.get("think", False)),
        max_daily_usd=float(claude.get("max_daily_usd", 2.0)),
        fallback_model=raw.get("fallback_model"),
        claude_model=claude.get("model", "claude-sonnet-5"),
    )


def load_config(path: Path = CONFIG_PATH) -> AIConfig:
    data = tomllib.loads(path.read_text()) if path.exists() else {}
    ai = data.get("ai", {})
    return AIConfig(live=_stage("live", ai, "qwen3:4b"), batch=_stage("batch", ai, "qwen3:8b"))


def with_provider(stage: StageConfig, provider: str | None,
                  base_url: str | None = None) -> StageConfig:
    """CLI override (`--provider fake|ollama|claude|cloud`, `--base-url`). For `cloud` the model is
    "auto": the Worker's default (first model in its /api/tags)."""
    if base_url:
        stage = replace(stage, base_url=base_url.rstrip("/"))
    if provider is None or provider == stage.provider:
        return stage
    model = {"fake": "fake-1", "claude": stage.claude_model, "cloud": "auto"}.get(provider,
                                                                                 stage.model)
    return replace(stage, provider=provider, model=model)
