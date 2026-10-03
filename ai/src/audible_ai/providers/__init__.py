"""Provider adapters and construction from config."""

from __future__ import annotations

from audible_ai.config import StageConfig
from audible_ai.providers.base import (
    BudgetExceeded,
    GenerateResult,
    Message,
    Provider,
    ProviderError,
    ProviderUnavailable,
)

__all__ = [
    "BudgetExceeded", "GenerateResult", "Message", "Provider", "ProviderError",
    "ProviderUnavailable", "make_provider",
]


CLOUD_ATTEMPT_TIMEOUT_S = 25.0


def make_provider(stage: StageConfig) -> Provider:
    if stage.provider == "ollama":
        from audible_ai.providers.ollama import OllamaProvider

        return OllamaProvider(stage.model, stage.base_url, think=stage.think)
    if stage.provider == "cloud":
        from audible_ai.providers.ollama import OllamaProvider

        # A cloud attempt that takes longer than this is abandoned and retried once (SPEC §12).
        return OllamaProvider(stage.model, stage.base_url, think=stage.think, name="cloud",
                              attempt_timeout_s=CLOUD_ATTEMPT_TIMEOUT_S)
    if stage.provider == "claude":
        from audible_ai.providers.claude import ClaudeProvider

        return ClaudeProvider(stage.model, stage.max_daily_usd)
    if stage.provider == "fake":
        from audible_ai.providers.fake import FakeProvider

        return FakeProvider()
    raise ValueError(f"unknown provider {stage.provider!r}")
