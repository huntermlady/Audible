"""Generate → validate → one retry with the errors appended (SPEC §12)."""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from audible_ai import prompts, schemas
from audible_ai.factsheet import FactSheet
from audible_ai.providers.base import (
    GenerateResult,
    Provider,
    ProviderError,
    ProviderUnavailable,
)
from audible_ai.validate import validate_call, validate_report_body

MAX_ATTEMPTS = 2


@dataclass
class Outcome:
    ok: bool
    value: dict[str, Any] | None  # last parsed response (valid when ok)
    errors: list[str]
    attempts: int
    latency_ms: int
    first_token_ms: int | None
    first_attempt_errors: list[str] = field(default_factory=list)
    rate_wait_ms: int = 0
    results: list[GenerateResult] = field(default_factory=list)


def generate_validated(provider: Provider, prompt: prompts.RenderedPrompt, schema: dict,
                       validate: Callable[[Any], list[str]], *,
                       timeout_s: float = 120) -> Outcome:
    start = time.perf_counter()
    waited_before = getattr(provider, "rate_wait_ms", 0)
    user = prompt.user
    out = Outcome(ok=False, value=None, errors=[], attempts=0, latency_ms=0, first_token_ms=None)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        out.attempts = attempt
        try:
            res = provider.generate_json(prompt.system, user, schema, timeout_s=timeout_s)
        except ProviderUnavailable:
            raise
        except ProviderError as e:
            errors = [f"provider error: {e}"]
        else:
            out.results.append(res)
            if attempt == 1:
                out.first_token_ms = res.first_token_ms
            if res.parsed is None:
                errors = ["response is not a JSON object"]
            else:
                out.value = res.parsed
                errors = validate(res.parsed)
        if attempt == 1:
            out.first_attempt_errors = errors
        out.errors = errors
        if not errors:
            out.ok = True
            break
        user = prompts.retry_user(prompt.user, errors)
    # Time spent waiting out a provider's rate limit is not model latency.
    waited = getattr(provider, "rate_wait_ms", 0) - waited_before
    out.latency_ms = int((time.perf_counter() - start) * 1000) - waited
    out.rate_wait_ms = waited
    return out


def fact_ids(fs: Mapping[str, Any]) -> list[str]:
    return [f["id"] for f in fs["facts"]]


def run_call(fs: FactSheet, provider: Provider, *, timeout_s: float = 120) -> Outcome:
    """Situational CoordinatorCall for a situation fact sheet."""
    situation = fs["context"]["situation"]
    return generate_validated(
        provider, prompts.situational_prompt(fs),
        schemas.model_schema("call", fact_ids(fs), situation["role"]),
        lambda raw: validate_call(raw, fs, situation), timeout_s=timeout_s)


def run_report(fs: FactSheet, provider: Provider, *, timeout_s: float = 600) -> Outcome:
    """headline/keys/situational_calls for a matchup fact sheet."""
    return generate_validated(
        provider, prompts.report_prompt(fs),
        schemas.model_schema("report", fact_ids(fs), fs["context"]["role"]),
        lambda raw: validate_report_body(raw, fs), timeout_s=timeout_s)
