"""nflreadpy loaders with a per-season raw cache under ~/.cache/audible.

Completed seasons are cached indefinitely; the current season is re-downloaded once the cached
file is older than ``AUDIBLE_CACHE_MAX_AGE_HOURS`` (default 6). nflreadpy's own cache is disabled
so there is exactly one cache to persist in CI.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from pathlib import Path

import nflreadpy as nfl
import polars as pl
from nflreadpy.config import update_config

log = logging.getLogger(__name__)

CACHE_DIR = Path(os.environ.get("AUDIBLE_CACHE_DIR", Path.home() / ".cache" / "audible"))
CURRENT_MAX_AGE_S = float(os.environ.get("AUDIBLE_CACHE_MAX_AGE_HOURS", "6")) * 3600

update_config(cache_mode="off", verbose=False)


def current_season() -> int:
    return nfl.get_current_season()


def _cached(
    dataset: str, season: int, loader: Callable[[int], pl.DataFrame], *, refresh: bool
) -> pl.DataFrame | None:
    """Return the raw dataset for one season, or None when nflverse does not publish it."""
    path = CACHE_DIR / "raw" / dataset / f"{season}.parquet"
    missing = CACHE_DIR / "raw" / dataset / f"{season}.missing"
    is_current = season >= current_season()
    fresh = not refresh and (not is_current or _age(path) < CURRENT_MAX_AGE_S)
    if path.exists() and fresh:
        return pl.read_parquet(path)
    if missing.exists() and fresh and _age(missing) < CURRENT_MAX_AGE_S:
        return None
    try:
        df = loader(season)
    except ValueError as exc:  # nflreadpy raises ValueError for seasons outside a dataset's range
        log.info("%s %s unavailable: %s", dataset, season, exc)
        missing.parent.mkdir(parents=True, exist_ok=True)
        missing.touch()
        return None
    except Exception:
        if path.exists():
            log.warning("%s %s download failed; using stale cache", dataset, season, exc_info=True)
            return pl.read_parquet(path)
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    df.write_parquet(tmp)
    tmp.replace(path)
    missing.unlink(missing_ok=True)
    return df


def _age(path: Path) -> float:
    return time.time() - path.stat().st_mtime if path.exists() else float("inf")


def load_pbp(season: int, *, refresh: bool = False) -> pl.DataFrame | None:
    return _cached("pbp", season, nfl.load_pbp, refresh=refresh)


def load_ftn(season: int, *, refresh: bool = False) -> pl.DataFrame | None:
    return _cached("ftn_charting", season, nfl.load_ftn_charting, refresh=refresh)


def load_participation(season: int, *, refresh: bool = False) -> pl.DataFrame | None:
    return _cached("participation", season, nfl.load_participation, refresh=refresh)


def load_player_stats(season: int, *, refresh: bool = False) -> pl.DataFrame | None:
    return _cached("player_stats_week", season, nfl.load_player_stats, refresh=refresh)


def load_schedule(season: int, *, refresh: bool = False) -> pl.DataFrame | None:
    return _cached("schedules", season, nfl.load_schedules, refresh=refresh)
