"""Claude adapter (anthropic SDK) with a local daily spend cap (`[ai.claude].max_daily_usd`)."""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

from audible_ai.providers.base import (
    BudgetExceeded,
    GenerateResult,
    Message,
    ProviderError,
    parse_json_object,
)

DEFAULT_SPEND_FILE = Path.home() / ".cache" / "audible" / "claude_spend.json"

# USD per 1M tokens (input, output). Unknown models are priced at the most expensive tier.
PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-5": (2.00, 10.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-fable-5-1": (10.00, 50.00),
}
FALLBACK_PRICE = (10.00, 50.00)

# Structured outputs reject these keywords (they are enforced locally by validate.py instead).
_CLAUDE_UNSUPPORTED = ("minItems", "maxItems", "minimum", "maximum", "minLength", "maxLength",
                       "pattern", "uniqueItems")


def api_key_from_env(dotenv: Path | None = None) -> str | None:
    """ANTHROPIC_API_KEY from the environment, else from the repo-root .env (never committed)."""
    import os

    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    if dotenv is None:
        from audible_contracts.paths import REPO_ROOT

        dotenv = REPO_ROOT / ".env"
    try:
        lines = dotenv.read_text().splitlines()
    except FileNotFoundError:
        return None
    for line in lines:
        key, sep, value = line.strip().partition("=")
        if sep and key.strip().removeprefix("export ").strip() == "ANTHROPIC_API_KEY":
            return value.strip().strip("'\"") or None
    return None


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICING.get(model, FALLBACK_PRICE)
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


class SpendTracker:
    """Per-day spend in a local JSON file: {"YYYY-MM-DD": usd}."""

    def __init__(self, max_daily_usd: float, path: Path = DEFAULT_SPEND_FILE,
                 today: Any = date.today) -> None:
        self.max_daily_usd = max_daily_usd
        self.path = path
        self._today = today

    def _load(self) -> dict[str, float]:
        try:
            data = json.loads(self.path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def spent_today(self) -> float:
        return float(self._load().get(self._today().isoformat(), 0.0))

    def check(self) -> None:
        spent = self.spent_today()
        if spent >= self.max_daily_usd:
            raise BudgetExceeded(
                f"Claude daily budget reached: ${spent:.2f} of ${self.max_daily_usd:.2f} "
                f"(tracked in {self.path})")

    def record(self, usd: float) -> None:
        data = self._load()
        key = self._today().isoformat()
        data[key] = round(float(data.get(key, 0.0)) + usd, 6)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2))


def claude_schema(schema: Any) -> Any:
    """Drop keywords that structured outputs does not accept (property names are kept)."""
    if isinstance(schema, dict):
        out = {}
        for k, v in schema.items():
            if k in _CLAUDE_UNSUPPORTED:
                continue
            if k == "properties":
                out[k] = {name: claude_schema(sub) for name, sub in v.items()}
            else:
                out[k] = claude_schema(v)
        return out
    if isinstance(schema, list):
        return [claude_schema(v) for v in schema]
    return schema


class ClaudeProvider:
    """Temperature is not sent: current Claude models reject sampling parameters."""

    name = "claude"

    def __init__(self, model: str, max_daily_usd: float, *, spend: SpendTracker | None = None,
                 client: Any = None, max_tokens: int = 8192) -> None:
        self.model = model
        self.spend = spend or SpendTracker(max_daily_usd)
        self.max_tokens = max_tokens
        if client is None:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key_from_env())
        self._client = client

    def _record(self, usage: Any) -> tuple[int | None, int | None]:
        if usage is None:
            return None, None
        tin = int(getattr(usage, "input_tokens", 0) or 0)
        tin += int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
        tin += int(getattr(usage, "cache_read_input_tokens", 0) or 0)
        tout = int(getattr(usage, "output_tokens", 0) or 0)
        self.spend.record(cost_usd(self.model, tin, tout))
        return tin, tout

    def generate_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.2,
                      timeout_s: float = 120) -> GenerateResult:
        import anthropic

        self.spend.check()
        start = time.perf_counter()
        first: int | None = None
        parts: list[str] = []
        try:
            with self._client.with_options(timeout=timeout_s).messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={"format": {"type": "json_schema", "schema": claude_schema(schema)}},
            ) as stream:
                for text in stream.text_stream:
                    if first is None:
                        first = int((time.perf_counter() - start) * 1000)
                    parts.append(text)
                final = stream.get_final_message()
        except anthropic.APIStatusError as e:
            raise ProviderError(f"claude HTTP {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise ProviderError(f"claude connection failed: {e}") from e
        tin, tout = self._record(final.usage)
        text = "".join(parts)
        return GenerateResult(
            raw_text=text,
            parsed=parse_json_object(text) if final.stop_reason != "refusal" else None,
            latency_ms=int((time.perf_counter() - start) * 1000),
            first_token_ms=first,
            prompt_tokens=tin,
            output_tokens=tout,
        )

    def stream_text(self, system: str, messages: list[Message], *,
                    temperature: float = 0.4) -> Iterator[str]:
        self.spend.check()
        with self._client.messages.stream(
            model=self.model, max_tokens=self.max_tokens, system=system,
            messages=list(messages),
        ) as stream:
            yield from stream.text_stream
            self._record(stream.get_final_message().usage)
