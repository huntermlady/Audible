"""Provider interface (BUILD_PLAN §5.4)."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypedDict


class Message(TypedDict):
    role: Literal["user", "assistant"]
    content: str


@dataclass
class GenerateResult:
    raw_text: str
    parsed: dict[str, Any] | None
    latency_ms: int
    first_token_ms: int | None
    prompt_tokens: int | None
    output_tokens: int | None


class ProviderError(RuntimeError):
    """The provider could not produce a response (transport, HTTP, or API error)."""


class ProviderUnavailable(ProviderError):
    """The provider is not reachable at all (e.g. Ollama is not running)."""


class BudgetExceeded(ProviderError):
    """The Claude spend tracker refused the call (max_daily_usd reached)."""


class Provider(Protocol):
    name: str
    model: str

    def generate_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.2,
                      timeout_s: float = 120) -> GenerateResult: ...

    def stream_text(self, system: str, messages: list[Message], *,
                    temperature: float = 0.4) -> Iterator[str]: ...


def parse_json_object(text: str) -> dict[str, Any] | None:
    """Parse model output as a JSON object; tolerate code fences. None if it is not one."""
    import json

    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    try:
        value = json.loads(t)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None
