"""Weekly batch job: 4 game-plan reports per game in the week, plus Play-Caller samples.

For each game: {home, away} × {OC, DC} → matchup fact sheet → provider → validate (1 retry) →
reports/{season}/{week}/{game_id}.{team}.{role}.json → reports/index.json.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from audible_ai import factsheet, schemas
from audible_ai.coordinator import run_call, run_report
from audible_ai.data import (
    DATA_DIR,
    REPORTS_DIR,
    load_fact_sheet_rows,
    load_manifest,
    load_schedule,
)
from audible_ai.providers.base import Provider

log = logging.getLogger("audible_ai.reports")

REPORT_VERSION = "1.0.0"
ROLES = ("OC", "DC")
CALL_SLOTS = ("early_down", "third_short", "third_long", "red_zone", "two_minute")

# Play-Caller sample situations: (role, down, distance, yardline_100, quarter, clock, score_diff).
# Applied to the week's first games; the offense is the away team.
SAMPLE_SITUATIONS = (
    ("OC", 3, 7, 35, 4, 130, -4),
    ("DC", 3, 8, 42, 2, 95, 3),
    ("OC", 1, 10, 12, 3, 420, 0),
    ("DC", 2, 6, 64, 1, 600, -7),
)


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def report_path(season: int, week: int, game_id: str, team: str, role: str) -> str:
    return f"{season}/{week}/{game_id}.{team}.{role}.json"


def _placeholder_call(role: str, fs: Mapping[str, Any]) -> dict[str, Any]:
    ids = [f["id"] for f in fs["facts"]][:2]
    oc = role == "OC"
    option = {"play_family": "quick_pass" if oc else None, "direction": None,
              "concept": "Unavailable", "front": None if oc else "even",
              "coverage_shell": None if oc else "cover3", "pressure": None if oc else "none"}
    return {"role": role, "primary": option, "alternatives": [],
            "rationale": [{"text": "Unavailable", "stat_ids": [sid]} for sid in ids],
            "confidence": "low", "caveats": ["Report failed validation."]}


def placeholder_body(fs: Mapping[str, Any]) -> dict[str, Any]:
    """Schema-valid stand-in for a report whose model output was not schema-valid. It is written
    with validation_status "failed", which the UI never shows."""
    role = fs["context"]["role"]
    ids = [f["id"] for f in fs["facts"]] or ["XX.off.0000.overall.all.none"]
    ids = (ids * 3)[:3]
    return {
        "headline": "Report failed validation.",
        "keys": [{"title": "Unavailable", "detail": "Unavailable", "stat_ids": [sid]}
                 for sid in ids],
        "situational_calls": {slot: _placeholder_call(role, fs) for slot in CALL_SLOTS},
    }


def build_report(game: Mapping[str, Any], team: str, opponent: str, role: str,
                 tendencies: list[dict[str, Any]], provider: Provider, stats_as_of: str,
                 generated_at: str) -> dict[str, Any]:
    ctx = {"kind": "matchup", "game_id": game["game_id"], "season": game["season"],
           "team": team, "opponent": opponent, "role": role}
    fs = factsheet.build(ctx, tendencies)
    outcome = run_report(fs, provider)
    body = outcome.value
    if outcome.ok:
        status = "passed"
    else:
        status = "failed"
        log.warning("%s %s %s failed validation after %d attempts: %s", game["game_id"], team,
                    role, outcome.attempts, "; ".join(outcome.errors[:5]))
        if body is None or schemas.report_body_errors(body):
            body = placeholder_body(fs)
    assert body is not None
    return {
        "report_version": REPORT_VERSION,
        "game_id": game["game_id"],
        "season": game["season"],
        "week": game["week"],
        "team": team,
        "opponent": opponent,
        "role": role,
        "generated_at": generated_at,
        "stats_as_of": stats_as_of,
        "provider": provider.name,
        "model": provider.model,
        "validation_status": status,
        "fact_sheet": fs,
        "headline": body["headline"],
        "keys": body["keys"],
        "situational_calls": {slot: body["situational_calls"][slot] for slot in CALL_SLOTS},
    }


def index_entry(report: Mapping[str, Any], path: str) -> dict[str, Any]:
    return {k: report[k] for k in ("season", "week", "game_id", "team", "opponent", "role")} | {
        "path": path,
        **{k: report[k] for k in ("generated_at", "stats_as_of", "model", "validation_status")},
    }


def _entry_key(e: Mapping[str, Any]) -> tuple:
    return (e["season"], e["week"], e["game_id"], e["team"], e["role"])


def update_index(out_dir: Path, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    path = out_dir / "index.json"
    existing: list[dict[str, Any]] = json.loads(path.read_text()) if path.exists() else []
    merged = {_entry_key(e): e for e in existing}
    merged.update({_entry_key(e): e for e in entries})
    index = sorted(merged.values(), key=_entry_key)
    write_json(path, index)
    return index


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def build_samples(games: Sequence[Mapping[str, Any]], tendencies: list[dict[str, Any]],
                  provider: Provider, generated_at: str) -> list[dict[str, Any]]:
    samples = []
    for i, (role, down, dist, yl, qtr, clock, diff) in enumerate(SAMPLE_SITUATIONS):
        game = games[i % len(games)]
        situation = {"role": role, "offense": game["away_team"], "defense": game["home_team"],
                     "season": game["season"], "down": down, "distance": dist,
                     "yardline_100": yl, "quarter": qtr, "clock_seconds": clock,
                     "score_diff": diff, "timeouts_offense": 2, "timeouts_defense": 2}
        fs = factsheet.build({"kind": "situation", "situation": situation}, tendencies)
        outcome = run_call(fs, provider)
        if outcome.ok and outcome.value is not None:
            samples.append({"situation": fs["context"]["situation"], "fact_sheet": fs,
                            "call": outcome.value, "generated_at": generated_at,
                            "model": provider.model})
        else:
            log.warning("sample %d (%s) failed validation: %s", i, role,
                        "; ".join(outcome.errors[:5]))
    return samples


@dataclass
class RunSummary:
    season: int
    week: int
    games: int
    written: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    samples: int = 0


def _reusable(path: Path) -> dict[str, Any] | None:
    """A report on disk that a resumed run may keep: schema-valid and passed."""
    try:
        report = json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return None
    if schemas.errors("game_plan_report", report) or report["validation_status"] != "passed":
        return None
    return report


def resolve_week(week: str | int, manifest: Mapping[str, Any]) -> tuple[int, int]:
    season = int(manifest["current_season"])
    if week == "auto":
        return season, int(manifest["current_week"])
    return season, int(week)


def run(provider: Provider, week: str | int = "auto", *, data_dir: Path = DATA_DIR,
        out_dir: Path = REPORTS_DIR, games_filter: Callable[[dict], bool] | None = None,
        with_samples: bool = True, skip_existing: bool = False) -> RunSummary:
    """Generate the week's reports. The index is updated after every report, so a killed run
    leaves reports/ and index.json consistent. `skip_existing` keeps reports already on disk that
    are schema-valid and passed (a resumed run)."""
    manifest = load_manifest(data_dir)
    season, wk = resolve_week(week, manifest)
    games = [g for g in load_schedule(data_dir) if g["season"] == season and g["week"] == wk]
    if games_filter is not None:
        games = [g for g in games if games_filter(g)]
    games.sort(key=lambda g: g["game_id"])
    summary = RunSummary(season=season, week=wk, games=len(games))
    if not games:
        log.info("no games in season %d week %d", season, wk)
        return summary

    tendencies = load_fact_sheet_rows(season, None, data_dir)
    generated_at = utc_now()
    entries = []
    try:
        for game in games:
            for team, opponent in ((game["home_team"], game["away_team"]),
                                   (game["away_team"], game["home_team"])):
                for role in ROLES:
                    rel = report_path(season, wk, game["game_id"], team, role)
                    existing = _reusable(out_dir / rel) if skip_existing else None
                    if existing is not None:
                        entries.append(index_entry(existing, rel))
                        update_index(out_dir, entries[-1:])
                        summary.skipped.append(rel)
                        log.info("kept %s (already passed)", rel)
                        continue
                    report = build_report(game, team, opponent, role, tendencies, provider,
                                          manifest["stats_as_of"], generated_at)
                    errs = schemas.errors("game_plan_report", report)
                    if errs:
                        raise RuntimeError(f"built an invalid report: {errs[:3]}")
                    write_json(out_dir / rel, report)
                    entries.append(index_entry(report, rel))
                    update_index(out_dir, entries[-1:])
                    (summary.written if report["validation_status"] == "passed"
                     else summary.failed).append(rel)
                    log.info("wrote %s (%s)", rel, report["validation_status"])
    finally:
        # Keep the index consistent with what is on disk even if the run stops midway.
        if entries:
            update_index(out_dir, entries)

    if with_samples:
        samples = build_samples(games, tendencies, provider, generated_at)
        if len(samples) >= 3:
            write_json(out_dir / "samples" / "playcaller.json", samples[:5])
            summary.samples = len(samples)
        else:
            log.warning("only %d valid Play-Caller samples; keeping the existing samples file",
                        len(samples))
    return summary
