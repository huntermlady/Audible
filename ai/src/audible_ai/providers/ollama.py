"""Ollama adapter: POST /api/chat with `format` = JSON Schema, streamed NDJSON."""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from typing import Any

import httpx

from audible_ai.providers.base import (
    GenerateResult,
    Message,
    ProviderError,
    ProviderUnavailable,
    parse_json_object,
)


class RateLimited(ProviderError):
    """HTTP 429 from an Ollama-compatible server (the cloud Worker's per-IP limit)."""

    def __init__(self, message: str, retry_after_s: float) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


class OllamaProvider:
    """Ollama `/api/chat`. With `name="cloud"` it talks to the audible-ai Worker, which serves the
    same API (CONTRACT_CHANGES item 19); 429s are then waited out (`max_rate_waits` times)."""

    def __init__(self, model: str, base_url: str = "http://localhost:11434", *,
                 think: bool = False, client: httpx.Client | None = None, name: str = "ollama",
                 max_rate_waits: int = 3, sleep: Any = time.sleep,
                 attempt_timeout_s: float | None = None) -> None:
        self.name = name
        self.attempt_timeout_s = attempt_timeout_s
        self.rate_wait_ms = 0  # total time spent waiting out 429s (excluded from latency)
        self.model = model
        self.max_rate_waits = max_rate_waits
        self._sleep = sleep
        self.base_url = base_url.rstrip("/")
        self.think = think
        self._client = client or httpx.Client()

    def health(self, timeout_s: float = 2.0) -> tuple[bool, list[str]]:
        """(reachable, installed model tags)."""
        try:
            r = self._client.get(f"{self.base_url}/api/tags", timeout=timeout_s)
            r.raise_for_status()
        except httpx.HTTPError:
            return False, []
        return True, [m["name"] for m in r.json().get("models", [])]

    def _chat(self, body: dict[str, Any], timeout_s: float) -> Iterator[dict[str, Any]]:
        timeout = httpx.Timeout(timeout_s, connect=5.0)
        try:
            with self._client.stream("POST", f"{self.base_url}/api/chat", json=body,
                                     timeout=timeout) as r:
                if r.status_code != 200:
                    r.read()
                    if r.status_code == 429:
                        retry = float(r.headers.get("Retry-After", "60") or 60)
                        raise RateLimited(f"{self.name} HTTP 429: {r.text[:200]}", retry)
                    raise ProviderError(f"{self.name} HTTP {r.status_code}: {r.text[:300]}")
                for line in r.iter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if "error" in chunk:
                        raise ProviderError(f"ollama: {chunk['error']}")
                    yield chunk
        except httpx.ConnectError as e:
            what = "The cloud Worker" if self.name == "cloud" else "Ollama"
            raise ProviderUnavailable(f"{what} is not reachable at {self.base_url}") from e
        except httpx.HTTPError as e:
            raise ProviderError(f"ollama request failed: {e}") from e

    def generate_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.2,
                      timeout_s: float = 120) -> GenerateResult:
        for waits in range(self.max_rate_waits + 1):
            if self.attempt_timeout_s is not None:
                timeout_s = min(timeout_s, self.attempt_timeout_s)
            try:
                return self._generate_once(system, user, schema, temperature, timeout_s)
            except RateLimited as e:
                if waits == self.max_rate_waits:
                    raise
                # Waiting is not counted in latency: timing restarts with the next attempt.
                wait_s = min(e.retry_after_s, 90)
                self._sleep(wait_s)
                self.rate_wait_ms += int(wait_s * 1000)
        raise AssertionError("unreachable")

    def _generate_once(self, system: str, user: str, schema: dict, temperature: float,
                       timeout_s: float) -> GenerateResult:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "format": schema,
            "stream": True,
            "think": self.think,
            "options": {"temperature": temperature},
        }
        start = time.perf_counter()
        first: int | None = None
        parts: list[str] = []
        final: dict[str, Any] = {}
        for chunk in self._chat(body, timeout_s):
            content = chunk.get("message", {}).get("content", "")
            if content:
                if first is None:
                    first = int((time.perf_counter() - start) * 1000)
                parts.append(content)
            if chunk.get("done"):
                final = chunk
        text = "".join(parts)
        return GenerateResult(
            raw_text=text,
            parsed=parse_json_object(text),
            latency_ms=int((time.perf_counter() - start) * 1000),
            first_token_ms=first,
            prompt_tokens=final.get("prompt_eval_count"),
            output_tokens=final.get("eval_count"),
        )

    def stream_text(self, system: str, messages: list[Message], *,
                    temperature: float = 0.4) -> Iterator[str]:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": True,
            "think": self.think,
            "options": {"temperature": temperature},
        }
        for chunk in self._chat(body, 300):
            content = chunk.get("message", {}).get("content", "")
            if content:
                yield content
