"""DuckDB aggregate expressions shared by team_week, team_season and team_tendencies.

Every rate is an ``avg`` over its denominator's plays, so an empty denominator yields NULL.
"""

from __future__ import annotations

LOW_SAMPLE_PLAYS = 20

EPA_PER_PLAY = "avg(epa)"
SUCCESS_RATE = "avg(success::DOUBLE)"
EXPLOSIVE_RATE = "avg(explosive::DOUBLE)"
PASS_RATE = "avg(is_pass::DOUBLE)"
PROE = "avg(is_pass::DOUBLE - xpass)"
PASS_EPA = "avg(epa) FILTER (WHERE is_pass)"
RUN_EPA = "avg(epa) FILTER (WHERE NOT is_pass)"
EARLY_DOWN_PASS_RATE = "avg(is_pass::DOUBLE) FILTER (WHERE down IN (1, 2))"
THIRD_DOWN_CONV_RATE = "avg(converted::DOUBLE) FILTER (WHERE down = 3)"
BLITZ_RATE = "avg(blitz::DOUBLE)"
PRESSURE_RATE = "avg(pressure::DOUBLE)"


def _share(column: str, value: str, where: str) -> str:
    return f"avg(({column} = '{value}')::DOUBLE) FILTER (WHERE {where} AND {column} IS NOT NULL)"


RUN_WHERE = "NOT is_pass"
PASS_LOC_WHERE = "is_pass_attempt"

# team_tendencies metric columns, in contract order (plan §5.2.4).
TENDENCY_METRICS: dict[str, str] = {
    "plays": "count(*)::INTEGER",
    "low_sample": f"count(*) < {LOW_SAMPLE_PLAYS}",
    "pass_rate": PASS_RATE,
    "proe": PROE,
    "epa_per_play": EPA_PER_PLAY,
    "success_rate": SUCCESS_RATE,
    "explosive_rate": EXPLOSIVE_RATE,
    "pass_epa": PASS_EPA,
    "run_epa": RUN_EPA,
    "pass_success_rate": "avg(success::DOUBLE) FILTER (WHERE is_pass)",
    "run_success_rate": "avg(success::DOUBLE) FILTER (WHERE NOT is_pass)",
    "avg_air_yards": "avg(air_yards) FILTER (WHERE is_pass_attempt)",
    "deep_pass_rate": "avg((air_yards >= 20)::DOUBLE) FILTER (WHERE is_pass_attempt)",
    "screen_rate": "avg(screen::DOUBLE)",
    "play_action_rate": "avg(play_action::DOUBLE)",
    "shotgun_rate": "avg(shotgun)",
    "no_huddle_rate": "avg(no_huddle)",
    "run_left_rate": _share("run_location", "left", RUN_WHERE),
    "run_middle_rate": _share("run_location", "middle", RUN_WHERE),
    "run_right_rate": _share("run_location", "right", RUN_WHERE),
    "pass_left_rate": _share("pass_location", "left", PASS_LOC_WHERE),
    "pass_middle_rate": _share("pass_location", "middle", PASS_LOC_WHERE),
    "pass_right_rate": _share("pass_location", "right", PASS_LOC_WHERE),
    "sack_rate": "avg((sack = 1)::DOUBLE) FILTER (WHERE is_pass)",
    "blitz_rate": BLITZ_RATE,
    "pressure_rate": PRESSURE_RATE,
    "man_rate": "avg((man_zone = 'man')::DOUBLE)",
    "zone_rate": "avg((man_zone = 'zone')::DOUBLE)",
}


def select_list(metrics: dict[str, str], prefix: str = "") -> str:
    return ",\n  ".join(f"{expr} AS {prefix}{name}" for name, expr in metrics.items())
