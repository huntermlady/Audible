"""Eval harness (BUILD_PLAN §5.6): 12 scenarios × {live, batch} configs → scorecard →
eval/results/<timestamp>.json."""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from audible_ai import factsheet, schemas
from audible_ai.config import StageConfig
from audible_ai.coordinator import run_call
from audible_ai.data import load_fact_sheet_rows
from audible_ai.providers.base import Provider
from audible_contracts.paths import FIXTURE_DATA_DIR, REPO_ROOT, SCENARIOS_DIR

RESULTS_DIR = REPO_ROOT / "eval" / "results"
# Workers AI neurons per million tokens (input, output), from Cloudflare's published prices at
# $0.011 per 1,000 neurons. Used only for the cloud cost estimate in the scorecard.
NEURONS_PER_M_TOKENS = {"qwen3-30b-a3b": (4_627, 30_455), "llama-3.1-8b": (13_778, 26_128),
                        "llama-4-scout": (24_545, 77_273)}
# BUILD_PLAN §8 live thresholds.
FIRST_TOKEN_MS_MAX = 3000
TOTAL_MS_MAX = 20000


def load_scenarios(directory: Path = SCENARIOS_DIR) -> list[dict[str, Any]]:
    return [json.loads(p.read_text()) for p in sorted(directory.glob("*.json"))]


def acceptable(scenario: Mapping[str, Any], call: Mapping[str, Any] | None) -> bool:
    if call is None:
        return False
    primary = call["primary"]
    if scenario["situation"]["role"] == "OC":
        family = primary["play_family"]
        ok = scenario["acceptable_play_families"] is None or \
            family in scenario["acceptable_play_families"]
        bad = scenario["unacceptable_play_families"] or []
        return ok and family not in bad
    checks = (("pressure", "acceptable_pressures"),
              ("coverage_shell", "acceptable_coverage_shells"),
              ("front", "acceptable_fronts"))
    ok = all(scenario.get(key) is None or primary[field] in scenario[key] for field, key in checks)
    return ok and primary["pressure"] not in (scenario.get("unacceptable_pressures") or [])


def percentile(values: list[int], p: float) -> int | None:
    """Nearest-rank percentile."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]


def run_scenario(scenario: Mapping[str, Any], provider: Provider) -> dict[str, Any]:
    situation = scenario["situation"]
    tendencies = load_fact_sheet_rows(situation["season"],
                                      [situation["offense"], situation["defense"], "NFL"],
                                      FIXTURE_DATA_DIR)
    fs = factsheet.build({"kind": "situation", "situation": situation}, tendencies)
    outcome = run_call(fs, provider)
    call = outcome.value
    schema_valid = call is not None and not schemas.errors("coordinator_call", call)
    return {
        "id": scenario["id"],
        "role": situation["role"],
        "attempts": outcome.attempts,
        "json_valid": schema_valid,
        "grounded": outcome.ok,
        "first_attempt_ok": not outcome.first_attempt_errors,
        "acceptable_family": outcome.ok and acceptable(scenario, call),
        "first_token_ms": outcome.first_token_ms,
        "prompt_tokens": sum(r.prompt_tokens or 0 for r in outcome.results),
        "output_tokens": sum(r.output_tokens or 0 for r in outcome.results),
        "total_ms": outcome.latency_ms,
        "errors": outcome.errors,
        "first_attempt_errors": outcome.first_attempt_errors,
        "rate_wait_ms": outcome.rate_wait_ms,
        "call": call,
        "defensible": None,
    }


def scorecard(rows: list[dict[str, Any]], stage: str, model: str = "") -> dict[str, Any]:
    n = len(rows) or 1
    first = [r["first_token_ms"] for r in rows if r["first_token_ms"] is not None]
    total = [r["total_ms"] for r in rows]
    card = {
        "scenarios": len(rows),
        "json_valid_pct": round(100 * sum(r["json_valid"] for r in rows) / n, 1),
        "grounded_pct": round(100 * sum(r["grounded"] for r in rows) / n, 1),
        "acceptable_family_pct": round(100 * sum(r["acceptable_family"] for r in rows) / n, 1),
        "first_token_ms_p50": percentile(first, 50),
        "first_token_ms_p95": percentile(first, 95),
        "total_ms_p50": percentile(total, 50),
        "total_ms_p95": percentile(total, 95),
        "defensible": None,
        "attempts_total": sum(r["attempts"] for r in rows),
        "prompt_tokens_total": sum(r.get("prompt_tokens", 0) for r in rows),
        "output_tokens_total": sum(r.get("output_tokens", 0) for r in rows),
        "est_neurons": None,
    }
    if model in NEURONS_PER_M_TOKENS:
        per_in, per_out = NEURONS_PER_M_TOKENS[model]
        card["est_neurons"] = round((card["prompt_tokens_total"] * per_in
                                     + card["output_tokens_total"] * per_out) / 1_000_000, 1)
    failing = []
    if card["json_valid_pct"] < 100:
        failing.append("json_valid")
    if card["grounded_pct"] < 100:
        failing.append("grounded")
    if stage == "live":
        first_p95, total_p95 = card["first_token_ms_p95"], card["total_ms_p95"]
        if first_p95 is not None and first_p95 > FIRST_TOKEN_MS_MAX:
            failing.append("first_token_latency")
        if total_p95 is not None and total_p95 > TOTAL_MS_MAX:
            failing.append("total_latency")
    card["failing_criteria"] = failing
    card["switch_to_claude_recommended"] = len(failing) >= 2
    return card


def run_eval(configs: list[tuple[StageConfig, Provider]],
             scenarios: list[dict[str, Any]] | None = None,
             rate: Callable[[dict[str, Any], dict[str, Any]], bool | None] | None = None,
             results_dir: Path = RESULTS_DIR) -> tuple[dict[str, Any], Path]:
    scenarios = scenarios if scenarios is not None else load_scenarios()
    started = datetime.now(UTC)
    result: dict[str, Any] = {"started_at": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
                              "configs": []}
    for stage, provider in configs:
        rows = []
        for sc in scenarios:
            row = run_scenario(sc, provider)
            if rate is not None and row["call"] is not None:
                row["defensible"] = rate(sc, row)
            rows.append(row)
        card = scorecard(rows, stage.stage, provider.model if provider.name == "cloud" else "")
        rated = [r["defensible"] for r in rows if r["defensible"] is not None]
        if rated:
            card["defensible"] = f"{sum(rated)}/{len(scenarios)}"
        result["configs"].append({"stage": stage.stage, "provider": provider.name,
                                  "model": provider.model, "scorecard": card,
                                  "scenarios": rows})
    results_dir.mkdir(parents=True, exist_ok=True)
    path = results_dir / f"{started.strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    return result, path


def format_scorecard(result: Mapping[str, Any]) -> str:
    lines = []
    header = (f"{'stage':<6} {'provider':<8} {'model':<22} {'json%':>6} {'grnd%':>6} "
              f"{'fam%':>6} {'ft p50':>7} {'ft p95':>7} {'tot p50':>8} {'tot p95':>8}  fails")
    lines.append(header)
    for cfg in result["configs"]:
        c = cfg["scorecard"]
        lines.append(
            f"{cfg['stage']:<6} {cfg['provider']:<8} {cfg['model']:<22} "
            f"{c['json_valid_pct']:>6} {c['grounded_pct']:>6} {c['acceptable_family_pct']:>6} "
            f"{str(c['first_token_ms_p50']):>7} {str(c['first_token_ms_p95']):>7} "
            f"{str(c['total_ms_p50']):>8} {str(c['total_ms_p95']):>8}  "
            f"{','.join(c['failing_criteria']) or '-'}")
    return "\n".join(lines)
