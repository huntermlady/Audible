"""``python -m audible_pipeline build --seasons auto|2021-2026 --out data``."""

from __future__ import annotations

import argparse
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import polars as pl

from audible_pipeline import clean, coverage, export, ingest
from audible_pipeline.aggregates import players, schedule, team_season, team_week, tendencies

log = logging.getLogger("audible_pipeline")

SEASONS_BACK = 5
WEEKLY_PLAYER_COLUMNS = [
    "player_id", "player_display_name", "position", "season", "week", "season_type", "team",
    "attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions",
    "sacks_suffered", "sack_yards_lost", "carries", "rushing_yards", "rushing_tds", "targets",
    "receptions", "receiving_yards", "receiving_tds", "receiving_air_yards",
    "receiving_yards_after_catch",
]  # fmt: skip


def parse_seasons(spec: str, current: int) -> list[int]:
    if spec == "auto":
        return list(range(current - SEASONS_BACK, current + 1))
    if "-" in spec:
        lo, hi = (int(x) for x in spec.split("-", 1))
        return list(range(lo, hi + 1))
    return sorted({int(x) for x in spec.split(",")})


@dataclass
class Inputs:
    schedule: list[pl.DataFrame] = field(default_factory=list)
    plays: list[pl.DataFrame] = field(default_factory=list)
    drives: list[pl.DataFrame] = field(default_factory=list)
    weekly: list[pl.DataFrame] = field(default_factory=list)
    available: dict[int, set[str]] = field(default_factory=dict)


def load_inputs(seasons: list[int], *, refresh: bool) -> Inputs:
    inputs = Inputs()
    for season in seasons:
        t0 = time.perf_counter()
        sched = ingest.load_schedule(season, refresh=refresh)
        if sched is None:
            raise SystemExit(f"no schedule for season {season}")
        sched = sched.filter(pl.col("season") == season)
        inputs.schedule.append(sched)
        pbp = ingest.load_pbp(season, refresh=refresh)
        if pbp is None or pbp.is_empty():
            log.warning("season %s: no play-by-play yet", season)
            inputs.available[season] = set()
            continue
        finals = clean.final_game_ids(sched)
        plays = clean.build_plays(
            pbp,
            finals,
            ftn=ingest.load_ftn(season, refresh=refresh),
            participation=ingest.load_participation(season, refresh=refresh),
        )
        cov = coverage.source_coverage(plays)
        available = {s for s, share in cov.items() if share >= coverage.MIN_COVERAGE}
        inputs.available[season] = available
        inputs.plays.append(coverage.apply_coverage(plays, available))
        inputs.drives.append(clean.build_drives(pbp, finals))
        weekly = ingest.load_player_stats(season, refresh=refresh)
        if weekly is not None:
            inputs.weekly.append(
                weekly.select(WEEKLY_PLAYER_COLUMNS).filter(pl.col("season_type") == "REG")
            )
        log.info(
            "season %s: %d plays, coverage %s (%.1fs)",
            season, plays.height, {k: round(v, 3) for k, v in cov.items()},
            time.perf_counter() - t0,
        )  # fmt: skip
    return inputs


def build(seasons: list[int], out: Path, *, refresh: bool = False) -> dict[str, object]:
    t_start = time.perf_counter()
    current = ingest.current_season()
    inputs = load_inputs(seasons, refresh=refresh)
    sched = pl.concat(inputs.schedule, how="vertical_relaxed")
    plays = pl.concat(inputs.plays, how="vertical_relaxed")
    drives = pl.concat(inputs.drives, how="vertical_relaxed")
    weekly = pl.concat(inputs.weekly, how="vertical_relaxed")
    reg_plays = plays.filter(pl.col("season_type") == "REG")
    reg_drives = drives.filter(pl.col("season_type") == "REG")

    tables = {
        "team_week": team_week.build(plays, sched),
        "team_season": team_season.build(reg_plays, reg_drives),
        "team_tendencies": tendencies.build(reg_plays),
        "player_season": players.build(weekly, reg_plays),
    }
    sched_rows = schedule.build(sched)
    current_season = current if current in seasons else max(seasons)
    manifest = export.write_all(
        out,
        tables=tables,
        schedule_records=schedule.to_records(sched_rows),
        current_season=current_season,
        current_week=schedule.current_week(sched_rows, current_season),
        seasons=seasons,
        stats_as_of=schedule.stats_as_of(sched_rows),
        optional_fields_by_season=coverage.optional_fields_by_season(inputs.available),
    )
    log.info("built %s in %.1fs", out, time.perf_counter() - t_start)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="audible_pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="build data/ from nflverse")
    b.add_argument("--seasons", default="auto", help="auto | 2021-2026 | 2024,2025")
    b.add_argument("--out", type=Path, default=Path("data"))
    b.add_argument("--refresh", action="store_true", help="re-download every cached season")
    b.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    seasons = parse_seasons(args.seasons, ingest.current_season())
    build(seasons, args.out, refresh=args.refresh)
    return 0
