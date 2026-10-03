from __future__ import annotations

import polars as pl

from audible_pipeline import cli
from audible_pipeline.aggregates import schedule


def _sched(rows: list[tuple[int, int, int | None]]) -> pl.DataFrame:
    return pl.DataFrame(
        [
            {"season": s, "week": w, "home_score": h, "gameday": f"{s}-09-{w:02d}"}
            for s, w, h in rows
        ]
    )


def test_current_week_is_first_week_with_unplayed_game() -> None:
    df = _sched([(2026, 1, 20), (2026, 2, 17), (2026, 3, 10), (2026, 3, None), (2026, 4, None)])
    assert schedule.current_week(df, 2026) == 3


def test_current_week_after_super_bowl_is_last_week() -> None:
    df = _sched([(2025, 1, 20), (2025, 22, 31)])
    assert schedule.current_week(df, 2025) == 22


def test_stats_as_of_is_latest_played_game() -> None:
    df = _sched([(2026, 1, 20), (2026, 2, 17), (2026, 3, None)])
    assert schedule.stats_as_of(df) == "2026-09-02"


def test_parse_seasons() -> None:
    assert cli.parse_seasons("auto", 2026) == [2021, 2022, 2023, 2024, 2025, 2026]
    assert cli.parse_seasons("2021-2023", 2026) == [2021, 2022, 2023]
    assert cli.parse_seasons("2024,2022", 2026) == [2022, 2024]
