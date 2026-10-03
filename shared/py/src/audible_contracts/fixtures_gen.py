"""Deterministic mock-data generator for shared/fixtures/data.

    python -m audible_contracts.fixtures_gen

Simulates play-by-play for every game with a small drive model, then aggregates the plays the way
the pipeline does (CONTEXT.md definitions), so every table is internally consistent: team_week
sums to team_season, tendency cells nest, and scores come from the simulated drives. The output
is mock data. It is plausible, but it is not real.

The profiles are tuned so the eval scenarios make sense: BAL blitzes heavily on 3rd & long, and KC
has the league's highest PROE. Optional-field coverage mirrors the real nflverse data
(CONTRACT_CHANGES #5): blitz exists in both seasons; pressure and man/zone are null for 2026.
The mock reports/samples in shared/fixtures/reports belong to T2; regenerate them with
`uv run python ai/scripts/make_fixture_reports.py`.
"""

from __future__ import annotations

import json
import math
import random
import tempfile
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from statistics import fmean
from typing import Any

from audible_contracts import mock
from audible_contracts.fixtures import write_rows
from audible_contracts.paths import FIXTURE_DATA_DIR, TEAMS_JSON

SEED = 20260925
SEASONS: tuple[int, ...] = (2025, 2026)
CURRENT_SEASON = 2026
CURRENT_WEEK = 4  # upcoming week: weeks 1-3 of 2026 are played
REG_WEEKS = 18
# Seasons in which each optional charting/participation field exists (mirrors real coverage).
BLITZ_SEASONS = frozenset({2025, 2026})
PARTICIPATION_SEASONS = frozenset({2025})  # pressure, man/zone
STATS_AS_OF = "2026-09-21"
GENERATED_AT = "2026-09-22T06:00:00Z"
SCHEMA_VERSION = "1.0.0"
LOW_SAMPLE_PLAYS = 20
FEATURED_GAME = (2026, 4, "KC", "BAL")  # (season, week, away, home)

# Week-1 Sunday per season; each week is +7 days. Byes: {week: number of teams on bye}.
WEEK1_SUNDAY = {2025: date(2025, 9, 7), 2026: date(2026, 9, 6)}
BYES = {
    2025: {5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 10: 4, 11: 4, 12: 4},
    2026: {5: 4, 6: 2, 7: 4, 8: 2, 9: 4, 10: 4, 11: 2, 12: 4, 13: 2, 14: 4},
}
POSTSEASON = {
    2025: [
        (19, "WC", date(2026, 1, 10)),
        (20, "DIV", date(2026, 1, 17)),
        (21, "CON", date(2026, 1, 25)),
        (22, "SB", date(2026, 2, 8)),
    ]
}

STADIUMS = {
    "ARI": "State Farm Stadium",
    "ATL": "Mercedes-Benz Stadium",
    "BAL": "M&T Bank Stadium",
    "BUF": "Highmark Stadium",
    "CAR": "Bank of America Stadium",
    "CHI": "Soldier Field",
    "CIN": "Paycor Stadium",
    "CLE": "Huntington Bank Field",
    "DAL": "AT&T Stadium",
    "DEN": "Empower Field at Mile High",
    "DET": "Ford Field",
    "GB": "Lambeau Field",
    "HOU": "NRG Stadium",
    "IND": "Lucas Oil Stadium",
    "JAX": "EverBank Stadium",
    "KC": "GEHA Field at Arrowhead Stadium",
    "LA": "SoFi Stadium",
    "LAC": "SoFi Stadium",
    "LV": "Allegiant Stadium",
    "MIA": "Hard Rock Stadium",
    "MIN": "U.S. Bank Stadium",
    "NE": "Gillette Stadium",
    "NO": "Caesars Superdome",
    "NYG": "MetLife Stadium",
    "NYJ": "MetLife Stadium",
    "PHI": "Lincoln Financial Field",
    "PIT": "Acrisure Stadium",
    "SEA": "Lumen Field",
    "SF": "Levi's Stadium",
    "TB": "Raymond James Stadium",
    "TEN": "Nissan Stadium",
    "WAS": "Northwest Stadium",
}
SUPER_BOWL_STADIUM = "Levi's Stadium"

FIRST_NAMES = [
    "Aaron",
    "Andre",
    "Bryce",
    "Caleb",
    "Cam",
    "Chris",
    "Dalton",
    "Darius",
    "Dante",
    "Derek",
    "Devin",
    "Drew",
    "Elijah",
    "Evan",
    "Garrett",
    "Isaiah",
    "Jalen",
    "Jamal",
    "Jaylen",
    "Jordan",
    "Josh",
    "Justin",
    "Kareem",
    "Keenan",
    "Kyle",
    "Lamar",
    "Logan",
    "Malik",
    "Marcus",
    "Mason",
    "Micah",
    "Miles",
    "Nate",
    "Nico",
    "Omar",
    "Parker",
    "Quentin",
    "Rashad",
    "Reggie",
    "Ryan",
    "Sam",
    "Terrell",
    "Tony",
    "Travis",
    "Tre",
    "Trey",
    "Tyler",
    "Victor",
    "Wes",
    "Xavier",
]
LAST_NAMES = [
    "Adams",
    "Allen",
    "Bailey",
    "Banks",
    "Barnes",
    "Bell",
    "Brooks",
    "Bryant",
    "Carter",
    "Coleman",
    "Collins",
    "Cooper",
    "Crawford",
    "Davis",
    "Dawson",
    "Dixon",
    "Ellis",
    "Evans",
    "Fields",
    "Fletcher",
    "Ford",
    "Foster",
    "Gibson",
    "Graham",
    "Grant",
    "Green",
    "Griffin",
    "Hall",
    "Harper",
    "Harris",
    "Hayes",
    "Henderson",
    "Hill",
    "Holmes",
    "Howard",
    "Hughes",
    "Jackson",
    "James",
    "Jenkins",
    "Johnson",
    "Jones",
    "Kelly",
    "King",
    "Lewis",
    "Lockett",
    "Marshall",
    "Mason",
    "Mitchell",
    "Moore",
    "Morgan",
    "Morris",
    "Murphy",
    "Nelson",
    "Owens",
    "Palmer",
    "Parker",
    "Patterson",
    "Payne",
    "Perry",
    "Porter",
    "Powell",
    "Reed",
    "Reynolds",
    "Rice",
    "Richardson",
    "Riley",
    "Roberts",
    "Robinson",
    "Ross",
    "Russell",
    "Sanders",
    "Scott",
    "Simmons",
    "Smith",
    "Stewart",
    "Sutton",
    "Taylor",
    "Thomas",
    "Tucker",
    "Turner",
    "Walker",
    "Ward",
    "Warren",
    "Washington",
    "Watson",
    "Webb",
    "Wells",
    "White",
    "Williams",
    "Wilson",
    "Wright",
    "Young",
]


# --------------------------------------------------------------------------------------------
# Buckets (CONTEXT.md; mirrors pipeline/buckets.py)
# --------------------------------------------------------------------------------------------
def dist_bucket(distance: int) -> str:
    if distance <= 3:
        return "short"
    if distance <= 6:
        return "medium"
    if distance <= 10:
        return "long"
    return "very_long"


def field_zone(yardline_100: int) -> str:
    if yardline_100 >= 90:
        return "backed_up"
    if yardline_100 >= 50:
        return "own_territory"
    if yardline_100 >= 21:
        return "opp_territory"
    return "red_zone"


def score_state(score_diff: int) -> str:
    if score_diff <= -9:
        return "trail_9plus"
    if score_diff < 0:
        return "trail_1_8"
    if score_diff == 0:
        return "tied"
    if score_diff <= 8:
        return "lead_1_8"
    return "lead_9plus"


def time_bucket(quarter: int, clock_seconds: int) -> str:
    if quarter in (2, 4) and clock_seconds <= 120:
        return "two_minute"
    if quarter >= 4:
        return "fourth_quarter"
    return "normal"


GROUPINGS: dict[str, tuple[str, ...]] = {
    "overall": (),
    "down_dist": ("down", "dist_bucket"),
    "down_dist_zone": ("down", "dist_bucket", "field_zone"),
    "zone": ("field_zone",),
    "score_time": ("score_state", "time_bucket"),
    "down_dist_score_time": ("down", "dist_bucket", "score_state", "time_bucket"),
}
DIMENSIONS = ("down", "dist_bucket", "field_zone", "score_state", "time_bucket")


def cell_key(dims: dict[str, Any]) -> str:
    """CONTRACTS §4.1 cell_key: `all`, or filled dimensions joined by `-`, down as `d{n}`."""
    if not dims:
        return "all"
    parts = [f"d{dims['down']}" if k == "down" else str(dims[k]) for k in DIMENSIONS if k in dims]
    return "-".join(parts)


# --------------------------------------------------------------------------------------------
# Profiles and rosters
# --------------------------------------------------------------------------------------------
@dataclass
class Profile:
    off_q: float  # offensive quality (EPA-ish units); + is better
    def_q: float  # defensive quality; + is better (allows less)
    pass_bias: float  # logit added to league xpass -> PROE
    blitz: float
    third_long_blitz: float  # added to blitz on 3rd & 7+
    pass_rush: float
    man: float
    shotgun: float
    no_huddle: float
    screen: float
    deep: float
    play_action: float
    run_dir: tuple[float, float, float]


def make_profiles(rng: random.Random, teams: list[str]) -> dict[int, dict[str, Profile]]:
    prev: dict[str, Profile] = {}
    out: dict[int, dict[str, Profile]] = {}
    for season in SEASONS:
        cur: dict[str, Profile] = {}
        for t in teams:
            p = Profile(
                off_q=rng.gauss(0, 0.04),
                def_q=rng.gauss(0, 0.035),
                pass_bias=rng.gauss(0, 0.16),
                blitz=min(0.4, max(0.14, rng.gauss(0.25, 0.05))),
                third_long_blitz=max(0.0, rng.gauss(0.1, 0.04)),
                pass_rush=rng.gauss(0, 0.05),
                man=min(0.5, max(0.18, rng.gauss(0.32, 0.07))),
                shotgun=min(0.9, max(0.45, rng.gauss(0.68, 0.09))),
                no_huddle=min(0.12, max(0.005, rng.gauss(0.035, 0.02))),
                screen=min(0.14, max(0.04, rng.gauss(0.085, 0.02))),
                deep=min(0.18, max(0.07, rng.gauss(0.115, 0.02))),
                play_action=min(0.34, max(0.14, rng.gauss(0.23, 0.04))),
                run_dir=(rng.uniform(0.28, 0.4), rng.uniform(0.22, 0.36), rng.uniform(0.28, 0.4)),
            )
            if t in prev:  # seasons are correlated
                old = prev[t]
                p.off_q = 0.6 * old.off_q + 0.7 * p.off_q
                p.def_q = 0.6 * old.def_q + 0.7 * p.def_q
                p.pass_bias = 0.6 * old.pass_bias + 0.8 * p.pass_bias
                p.blitz = 0.5 * old.blitz + 0.5 * p.blitz
                p.man = 0.5 * old.man + 0.5 * p.man
            cur[t] = p
        # Scenario anchors.
        cur["KC"].pass_bias = 0.5
        cur["KC"].off_q = max(cur["KC"].off_q, 0.08)
        cur["BAL"].blitz = 0.38
        cur["BAL"].third_long_blitz = 0.42
        cur["BAL"].def_q = max(cur["BAL"].def_q, 0.05)
        out[season] = cur
        prev = cur
    return out


@dataclass
class Player:
    player_id: str
    name: str
    position: str
    skill: float  # QB accuracy / RB yards / receiver separation


@dataclass
class Roster:
    qb: list[Player]
    rushers: list[tuple[Player, float]]
    targets: list[tuple[Player, float]]


def make_rosters(rng: random.Random, teams: list[str]) -> dict[str, Roster]:
    """One roster per team (used for both seasons). 40 QB, 70 RB, 110 WR, 60 TE in total."""
    used_names: set[str] = set()
    next_id = [33000]

    def new(pos: str, skill_sd: float) -> Player:
        while True:
            name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
            if name not in used_names:
                used_names.add(name)
                break
        next_id[0] += rng.randint(7, 61)
        return Player(f"00-00{next_id[0]:05d}", name, pos, rng.gauss(0, skill_sd))

    order = list(teams)
    rng.shuffle(order)
    backup_qb = set(order[:8])
    third_rb = set(order[8:14])
    fourth_wr = set(order[:14])
    one_te = set(order[28:])
    rosters: dict[str, Roster] = {}
    for t in teams:
        qbs = [new("QB", 0.03)] + ([new("QB", 0.03)] if t in backup_qb else [])
        rbs = [new("RB", 0.6) for _ in range(3 if t in third_rb else 2)]
        wrs = [new("WR", 0.04) for _ in range(4 if t in fourth_wr else 3)]
        tes = [new("TE", 0.04) for _ in range(1 if t in one_te else 2)]
        rushers = [(rbs[0], 0.55), (rbs[1], 0.30), (qbs[0], 0.08)]
        if len(rbs) > 2:
            rushers.append((rbs[2], 0.07))
        targets = [
            (wrs[0], 0.24),
            (wrs[1], 0.18),
            (wrs[2], 0.12),
            (tes[0], 0.17),
            (rbs[0], 0.10),
            (rbs[1], 0.05),
        ]
        if len(wrs) > 3:
            targets.append((wrs[3], 0.05))
        if len(tes) > 1:
            targets.append((tes[1], 0.05))
        rosters[t] = Roster(qbs, rushers, targets)
    return rosters


def weighted(rng: random.Random, items: list[tuple[Player, float]]) -> Player:
    return rng.choices([p for p, _ in items], weights=[w for _, w in items])[0]


# --------------------------------------------------------------------------------------------
# Schedule
# --------------------------------------------------------------------------------------------
@dataclass
class Game:
    season: int
    week: int
    game_type: str
    home: str
    away: str
    gameday: date
    gametime: str | None
    stadium: str | None
    spread_line: float | None = None
    total_line: float | None = None
    home_score: int | None = None
    away_score: int | None = None

    @property
    def game_id(self) -> str:
        return f"{self.season}_{self.week:02d}_{self.away}_{self.home}"


def expected_points(prof: dict[str, Profile], off: str, dfn: str, home: bool) -> float:
    return 22.0 + 60 * (prof[off].off_q - prof[dfn].def_q) + (1.0 if home else -0.5)


def half_round(x: float) -> float:
    return round(x * 2) / 2


def regular_schedule(
    rng: random.Random, season: int, teams: list[str], prof: dict[str, Profile]
) -> list[Game]:
    order = list(teams)
    rng.shuffle(order)
    bye_week: dict[str, int] = {}
    i = 0
    for week, n in BYES[season].items():
        for t in order[i : i + n]:
            bye_week[t] = week
        i += n
    assert i == len(teams)
    met: dict[frozenset[str], int] = defaultdict(int)
    home_games: dict[str, int] = defaultdict(int)
    games: list[Game] = []
    for week in range(1, REG_WEEKS + 1):
        avail = sorted(t for t in teams if bye_week[t] != week)
        pairs: list[tuple[str, str]] = []
        if (season, week) == FEATURED_GAME[:2]:
            _, _, away, home = FEATURED_GAME
            pairs.append((away, home))
            avail = [t for t in avail if t not in (away, home)]
        best: list[tuple[str, str]] = []
        best_cost = math.inf
        for _ in range(300):
            rng.shuffle(avail)
            cand = list(zip(avail[::2], avail[1::2], strict=True))
            cost = sum(met[frozenset(p)] for p in cand)
            if cost < best_cost:
                best, best_cost = cand, cost
            if cost == 0:
                break
        pairs += best
        sunday = WEEK1_SUNDAY[season] + timedelta(days=7 * (week - 1))
        for n, (a, b) in enumerate(pairs):
            met[frozenset((a, b))] += 1
            if (season, week) == FEATURED_GAME[:2] and n == 0:
                away, home = a, b
            else:
                away, home = (a, b) if home_games[a] > home_games[b] else (b, a)
            home_games[home] += 1
            if week == 1 and n == 1:
                day, time = sunday - timedelta(days=3), "20:20"  # Thursday opener
            elif n == len(pairs) - 1:
                day, time = sunday + timedelta(days=1), "20:15"  # Monday night
            else:
                day, time = sunday, ("13:00", "16:05", "16:25", "20:20")[min(3, n // 5)]
            if season == CURRENT_SEASON and week >= 17:
                time = None  # not yet scheduled (flex)
            g = Game(season, week, "REG", home, away, day, time, STADIUMS[home])
            if not (season == CURRENT_SEASON and week > CURRENT_WEEK + 1):
                eh = expected_points(prof, home, away, True)
                ea = expected_points(prof, away, home, False)
                g.spread_line, g.total_line = half_round(eh - ea), half_round(eh + ea)
            games.append(g)
    return games


# --------------------------------------------------------------------------------------------
# Play simulation
# --------------------------------------------------------------------------------------------
@dataclass(slots=True)
class Play:
    season: int
    week: int
    game_id: str
    season_type: str
    offense: str
    defense: str
    drive: int
    down: int
    distance: int
    yardline_100: int
    quarter: int
    clock: int
    score_diff: int
    is_pass: bool
    xpass: float
    yards: int = 0
    epa: float = 0.0
    air_yards: float | None = None
    cp: float | None = None
    complete: bool = False
    sack: bool = False
    interception: bool = False
    fumble_lost: bool = False
    touchdown: bool = False
    first_down: bool = False
    shotgun: bool = False
    no_huddle: bool = False
    screen: bool = False
    play_action: bool = False
    run_dir: str | None = None
    pass_dir: str | None = None
    blitz: bool = False
    pressure: bool = False
    man: bool = False
    passer: str | None = None
    rusher: str | None = None
    receiver: str | None = None

    @property
    def success(self) -> bool:
        return self.epa > 0

    @property
    def explosive(self) -> bool:
        return self.yards >= (20 if self.is_pass else 10)

    @property
    def attempt(self) -> bool:
        return self.is_pass and not self.sack


def sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z))


def expected_pts(down: int, distance: int, yardline_100: int) -> float:
    """Toy EP model: good enough for plausible EPA once league-centred."""
    ep = 6.3 - 0.078 * yardline_100
    ep -= (0.0, 0.0, 0.45, 1.0, 1.6)[down]
    ep -= 0.05 * (min(distance, 20) - 10)
    return ep


@dataclass
class GameState:
    quarter: int = 1
    clock: int = 900
    score: dict[str, int] = field(default_factory=dict)


class Simulator:
    def __init__(
        self,
        rng: random.Random,
        profiles: dict[int, dict[str, Profile]],
        rosters: dict[str, Roster],
    ):
        self.rng = rng
        self.profiles = profiles
        self.rosters = rosters
        self.drive_id = 0
        self.drives: list[dict[str, Any]] = []  # {season, season_type, offense, defense, rz, td}
        self.backup_games: dict[tuple[int, str], set[str]] = {}

    def qb_for(self, season: int, team: str, game_id: str, week: int) -> Player:
        qbs = self.rosters[team].qb
        if len(qbs) == 1:
            return qbs[0]
        key = (season, team)
        if key not in self.backup_games:
            weeks = list(range(1, REG_WEEKS + 1)) if season != CURRENT_SEASON else [1, 2, 3]
            k = 3 if season != CURRENT_SEASON else 1
            self.backup_games[key] = {str(w) for w in self.rng.sample(weeks, k)}
        return qbs[1] if str(week) in self.backup_games[key] else qbs[0]

    def play_game(self, g: Game) -> list[Play]:
        rng = self.rng
        st = GameState(score={g.home: 0, g.away: 0})
        receiver_first = g.away if rng.random() < 0.5 else g.home
        offense = receiver_first
        start = 75
        plays: list[Play] = []
        second_half_started = False
        while st.quarter <= 4:
            if st.quarter >= 3 and not second_half_started:
                second_half_started = True
                offense, start = (g.home if receiver_first == g.away else g.away), 75
            defense = g.home if offense == g.away else g.away
            next_start, ended_half = self.drive(g, st, offense, defense, start, plays)
            if ended_half and st.quarter == 3 and not second_half_started:
                continue
            offense, start = defense, next_start
        if st.score[g.home] == st.score[g.away]:  # overtime shorthand: a field goal decides it
            st.score[g.home if rng.random() < 0.55 else g.away] += 3
        g.home_score, g.away_score = st.score[g.home], st.score[g.away]
        return plays

    def tick(self, st: GameState, seconds: int) -> bool:
        """Run the clock; returns True when the half (or game) ends."""
        st.clock -= seconds
        if st.clock > 0:
            return False
        st.quarter += 1
        st.clock = 900
        return st.quarter in (3, 5)

    def drive(
        self, g: Game, st: GameState, off: str, dfn: str, start: int, plays: list[Play]
    ) -> tuple[int, bool]:
        rng = self.rng
        prof = self.profiles[g.season]
        po, pd = prof[off], prof[dfn]
        q = po.off_q - pd.def_q
        self.drive_id += 1
        drive = {
            "season": g.season,
            "season_type": "REG" if g.game_type == "REG" else "POST",
            "offense": off,
            "defense": dfn,
            "rz": start <= 20,
            "td": False,
        }
        self.drives.append(drive)
        down, dist, yl = 1, 10, start
        qb = self.qb_for(g.season, off, g.game_id, g.week)
        roster = self.rosters[off]
        while True:
            diff = st.score[off] - st.score[dfn]
            two_min = st.quarter in (2, 4) and st.clock <= 120
            if down == 4:
                go = (dist <= 2 and yl <= 55 and rng.random() < 0.45) or (
                    st.quarter == 4 and diff < 0 and (st.clock < 300 or diff <= -9)
                )
                if not go:
                    if yl <= 37:
                        made = rng.random() < max(0.4, 0.99 - 0.012 * max(0, yl - 10))
                        if made:
                            st.score[off] += 3
                        nxt = 75 if made else min(99, 100 - (yl + 7))
                    else:
                        spot = yl - rng.randint(36, 48)
                        nxt = 80 if spot <= 0 else 100 - spot
                    return nxt, self.tick(st, 6)
            late = st.quarter >= 4 or two_min
            z = 0.25 + (0.0, -0.3, 0.05, 0.55, 0.35)[down] + 0.09 * (min(dist, 20) - 8)
            if yl <= 3:
                z -= 0.9
            if late:
                z -= 0.07 * max(-21, min(21, diff))
            if two_min and st.quarter == 2:
                z += 0.5
            xpass = sigmoid(z)
            is_pass = rng.random() < sigmoid(z + po.pass_bias)
            p = Play(
                g.season,
                g.week,
                g.game_id,
                "REG" if g.game_type == "REG" else "POST",
                off,
                dfn,
                self.drive_id,
                down,
                dist,
                yl,
                st.quarter,
                st.clock,
                diff,
                is_pass,
                xpass,
            )
            p.no_huddle = rng.random() < (0.6 if two_min else po.no_huddle)
            p.shotgun = rng.random() < min(0.98, po.shotgun + (0.15 if is_pass else -0.25))
            if is_pass:
                self.sim_pass(p, po, pd, q, qb, roster)
            else:
                self.sim_run(p, po, q, roster)
            ep_before = expected_pts(down, dist, yl)
            turnover = p.interception or p.fumble_lost
            if p.yards >= yl and not turnover:
                p.yards = yl
                p.touchdown = True
            p.first_down = p.touchdown or (not turnover and p.yards >= dist)
            plays.append(p)
            seconds = (
                14 if two_min else (6 if p.attempt and not p.complete else rng.randint(26, 42))
            )
            if p.touchdown:
                p.epa = 7 - ep_before
                st.score[off] += 7 if rng.random() < 0.95 else 6
                drive["td"] = True
                return 75, self.tick(st, seconds)
            if turnover:
                spot = yl - (int(p.air_yards or 0) if p.interception else p.yards)
                opp_yl = 80 if spot <= 0 else min(99, max(1, 100 - spot))
                p.epa = -expected_pts(1, 10, opp_yl) - ep_before
                return opp_yl, self.tick(st, seconds)
            new_yl = min(99, yl - p.yards)
            if p.first_down:
                down, dist, yl = 1, min(10, new_yl), new_yl
            elif down == 4:
                p.epa = -expected_pts(1, 10, 100 - new_yl) - ep_before
                return 100 - new_yl, self.tick(st, seconds)
            else:
                down, dist, yl = down + 1, dist - p.yards, new_yl
                dist = max(1, min(dist, yl))
            p.epa = expected_pts(down, dist, yl) - ep_before
            if yl <= 20:
                drive["rz"] = True
            if self.tick(st, seconds):
                return 75, True

    def sim_pass(
        self, p: Play, po: Profile, pd: Profile, q: float, qb: Player, roster: Roster
    ) -> None:
        rng = self.rng
        third_long = p.down == 3 and p.distance >= 7
        blitz_p = pd.blitz + (pd.third_long_blitz if third_long else 0.0)
        p.blitz = rng.random() < blitz_p
        p.pressure = rng.random() < 0.3 + 0.12 * p.blitz + pd.pass_rush - 0.6 * q
        p.man = rng.random() < pd.man + (0.1 if third_long else 0.0)
        p.passer = qb.player_id
        if rng.random() < 0.02 + 0.14 * p.pressure - 0.1 * q:
            p.sack = True
            p.yards = -rng.randint(3, 10)
            p.fumble_lost = rng.random() < 0.08
            return
        p.play_action = rng.random() < (po.play_action if p.down <= 2 else 0.05)
        p.screen = not p.play_action and rng.random() < po.screen + (0.03 if p.blitz else 0.0)
        if p.screen:
            air = -rng.randint(1, 4)
        elif rng.random() < po.deep + (0.05 if p.play_action else 0.0):
            air = rng.randint(20, 45)
        else:
            air = round(rng.triangular(0, 19, 5))
        air = min(air, p.yardline_100)
        p.air_yards = float(air)
        p.pass_dir = rng.choices(["left", "middle", "right"], weights=[0.37, 0.23, 0.40])[0]
        target = weighted(rng, roster.targets)
        p.receiver = target.player_id
        p.cp = max(0.3, min(0.95, 0.8 - 0.011 * max(air, 0) + (0.08 if p.screen else 0.0)))
        actual = p.cp + qb.skill + target.skill + 0.7 * q - 0.12 * p.pressure
        if p.yardline_100 <= 20:  # compressed field
            actual -= 0.1
        if rng.random() < 0.012 + 0.018 * p.pressure + 0.0008 * max(air, 0) - 0.05 * q:
            p.interception = True
            return
        p.complete = rng.random() < actual
        if p.complete:
            yac = rng.expovariate(1 / (5.5 if p.screen else 4.2)) + 12 * q + 10 * target.skill
            p.yards = int(round(air + max(0.0, yac)))
            p.fumble_lost = rng.random() < 0.004

    def sim_run(self, p: Play, po: Profile, q: float, roster: Roster) -> None:
        rng = self.rng
        rusher = weighted(rng, roster.rushers)
        p.rusher = rusher.player_id
        p.run_dir = rng.choices(["left", "middle", "right"], weights=list(po.run_dir))[0]
        gain = rng.gauss(3.9 + 12 * q + rusher.skill - (1.6 if p.yardline_100 <= 20 else 0.0), 4.0)
        if rng.random() < 0.045:
            gain += rng.expovariate(1 / 16)
        p.yards = int(round(gain))
        p.fumble_lost = rng.random() < 0.006


# --------------------------------------------------------------------------------------------
# Postseason
# --------------------------------------------------------------------------------------------
def seeds(games: list[Game], teams_meta: list[dict[str, Any]], conf: str) -> list[str]:
    rec: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])  # win pts, point diff
    for g in games:
        assert g.home_score is not None and g.away_score is not None
        d = g.home_score - g.away_score
        rec[g.home][0] += 1.0 if d > 0 else 0.5 if d == 0 else 0.0
        rec[g.away][0] += 1.0 if d < 0 else 0.5 if d == 0 else 0.0
        rec[g.home][1] += d
        rec[g.away][1] -= d

    def key(t: str) -> tuple[float, float, str]:
        return (-rec[t][0], -rec[t][1], t)

    members = [t for t in teams_meta if t["conference"] == conf]
    divisions = sorted({t["division"] for t in members})
    winners = sorted(
        (min((t["abbr"] for t in members if t["division"] == d), key=key) for d in divisions),
        key=key,
    )
    rest = sorted((t["abbr"] for t in members if t["abbr"] not in winners), key=key)
    return winners + rest[:3]


def winner(g: Game) -> str:
    assert g.home_score is not None and g.away_score is not None
    return g.home if g.home_score > g.away_score else g.away


def play_postseason(
    season: int,
    played: list[Game],
    teams_meta: list[dict[str, Any]],
    prof: dict[str, Profile],
    sim: Simulator,
    plays_by_game: dict[str, list[Play]],
) -> list[Game]:
    """7 seeds per conference; seed 1 has a WC bye; the better seed hosts; SB at a neutral site."""
    conf_of = {t["abbr"]: t["conference"] for t in teams_meta}
    seeded = {c: seeds(played, teams_meta, c) for c in ("AFC", "NFC")}
    seed_no = {t: i for s in seeded.values() for i, t in enumerate(s)}
    alive = {c: list(s) for c, s in seeded.items()}
    out: list[Game] = []
    for week, gtype, day in POSTSEASON[season]:
        matchups: list[tuple[str, str]] = []  # (away, home)
        if gtype == "SB":
            matchups.append((alive["NFC"][0], alive["AFC"][0]))
        else:
            for conf in ("AFC", "NFC"):
                s = alive[conf][1:] if gtype == "WC" else alive[conf]
                matchups += [(s[len(s) - 1 - i], s[i]) for i in range(len(s) // 2)]
        survivors = {c: [s[0]] if gtype == "WC" else [] for c, s in alive.items()}
        for n, (away, home) in enumerate(matchups):
            neutral = gtype == "SB"
            g = Game(
                season,
                week,
                gtype,
                home,
                away,
                day + timedelta(days=0 if neutral else n % 2),
                "18:30" if neutral else ("16:30", "20:15")[n % 2],
                SUPER_BOWL_STADIUM if neutral else STADIUMS[home],
            )
            eh = expected_points(prof, home, away, not neutral)
            ea = expected_points(prof, away, home, False)
            g.spread_line, g.total_line = half_round(eh - ea), half_round(eh + ea)
            plays_by_game[g.game_id] = sim.play_game(g)
            out.append(g)
            w = winner(g)
            survivors[conf_of[w]].append(w)
        alive = {c: sorted(v, key=seed_no.__getitem__) for c, v in survivors.items()}
    return out


# --------------------------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------------------------
def r4(x: float | None) -> float | None:
    return None if x is None else round(x, 4)


def mean_or_none(xs: Iterable[float]) -> float | None:
    xs = list(xs)
    return fmean(xs) if xs else None


def rate(plays: list[Play], pred: Callable[[Play], bool]) -> float | None:
    return sum(1 for p in plays if pred(p)) / len(plays) if plays else None


def tendency_metrics(ps: list[Play], season: int) -> dict[str, Any]:
    blitz = season in BLITZ_SEASONS
    charted = season in PARTICIPATION_SEASONS
    drop = [p for p in ps if p.is_pass]
    runs = [p for p in ps if not p.is_pass]
    att = [p for p in drop if not p.sack]
    n = len(ps)
    m: dict[str, Any] = {
        "plays": n,
        "low_sample": n < LOW_SAMPLE_PLAYS,
        "pass_rate": len(drop) / n,
        "proe": fmean(float(p.is_pass) - p.xpass for p in ps),
        "epa_per_play": fmean(p.epa for p in ps),
        "success_rate": rate(ps, lambda p: p.success),
        "explosive_rate": rate(ps, lambda p: p.explosive),
        "pass_epa": mean_or_none(p.epa for p in drop),
        "run_epa": mean_or_none(p.epa for p in runs),
        "pass_success_rate": rate(drop, lambda p: p.success),
        "run_success_rate": rate(runs, lambda p: p.success),
        "avg_air_yards": mean_or_none(p.air_yards or 0.0 for p in att),
        "deep_pass_rate": rate(att, lambda p: (p.air_yards or 0) >= 20),
        "screen_rate": rate(drop, lambda p: p.screen),
        "play_action_rate": rate(drop, lambda p: p.play_action),
        "shotgun_rate": rate(ps, lambda p: p.shotgun),
        "no_huddle_rate": rate(ps, lambda p: p.no_huddle),
        "run_left_rate": rate(runs, lambda p: p.run_dir == "left"),
        "run_middle_rate": rate(runs, lambda p: p.run_dir == "middle"),
        "run_right_rate": rate(runs, lambda p: p.run_dir == "right"),
        "pass_left_rate": rate(att, lambda p: p.pass_dir == "left"),
        "pass_middle_rate": rate(att, lambda p: p.pass_dir == "middle"),
        "pass_right_rate": rate(att, lambda p: p.pass_dir == "right"),
        "sack_rate": rate(drop, lambda p: p.sack),
        "blitz_rate": rate(drop, lambda p: p.blitz) if blitz else None,
        "pressure_rate": rate(drop, lambda p: p.pressure) if charted else None,
        "man_rate": rate(drop, lambda p: p.man) if charted else None,
        "zone_rate": rate(drop, lambda p: not p.man) if charted else None,
    }
    return {k: (r4(v) if isinstance(v, float) else v) for k, v in m.items()}


def play_dims(p: Play) -> dict[str, Any]:
    return {
        "down": p.down,
        "dist_bucket": dist_bucket(p.distance),
        "field_zone": field_zone(p.yardline_100),
        "score_state": score_state(p.score_diff),
        "time_bucket": time_bucket(p.quarter, p.clock),
    }


def build_tendencies(season: int, plays: list[Play]) -> list[dict[str, Any]]:
    cells: dict[tuple[str, str, str, str], list[Play]] = defaultdict(list)
    dims_of: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for p in plays:
        full = play_dims(p)
        for grouping, dims in GROUPINGS.items():
            d = {k: full[k] for k in dims}
            key_ = cell_key(d)
            for team, side in ((p.offense, "off"), (p.defense, "def"), ("NFL", "off")):
                k = (team, side, grouping, key_)
                cells[k].append(p)
                dims_of[k] = d
    rows = []
    for k in sorted(cells, key=lambda k: (k[0], k[1], list(GROUPINGS).index(k[2]), k[3])):
        team, side, grouping, key_ = k
        d = dims_of[k]
        row: dict[str, Any] = {"season": season, "team": team, "side": side, "grouping": grouping}
        row.update({dim: d.get(dim) for dim in DIMENSIONS})
        row["cell_key"] = key_
        row.update(tendency_metrics(cells[k], season))
        rows.append(row)
    return rows


def game_rows(g: Game, plays: list[Play]) -> list[dict[str, Any]]:
    out = []
    for team, opp, is_home in ((g.home, g.away, True), (g.away, g.home, False)):
        off = [p for p in plays if p.offense == team]
        dfn = [p for p in plays if p.defense == team]
        pf = g.home_score if is_home else g.away_score
        pa = g.away_score if is_home else g.home_score
        out.append(
            {
                "season": g.season,
                "week": g.week,
                "game_id": g.game_id,
                "team": team,
                "opponent": opp,
                "is_home": is_home,
                "points_for": pf,
                "points_against": pa,
                "off_plays": len(off),
                "off_epa_per_play": r4(fmean(p.epa for p in off)),
                "off_success_rate": r4(rate(off, lambda p: p.success)),
                "off_pass_rate": r4(rate(off, lambda p: p.is_pass)),
                "off_proe": r4(fmean(float(p.is_pass) - p.xpass for p in off)),
                "def_plays": len(dfn),
                "def_epa_per_play": r4(fmean(p.epa for p in dfn)),
                "def_success_rate": r4(rate(dfn, lambda p: p.success)),
            }
        )
    return out


# Rank direction per CONTEXT.md: True = higher value ranks 1.
RANK_HIGH_IS_1 = {
    "off_epa_per_play": True,
    "off_pass_epa": True,
    "off_run_epa": True,
    "off_success_rate": True,
    "off_explosive_rate": True,
    "off_pass_rate": True,
    "off_proe": True,
    "off_early_down_pass_rate": True,
    "off_third_down_conv_rate": True,
    "off_red_zone_td_rate": True,
    "def_epa_per_play": False,
    "def_pass_epa": False,
    "def_run_epa": False,
    "def_success_rate": False,
    "def_explosive_rate": False,
    "def_third_down_conv_rate": False,
    "def_red_zone_td_rate": False,
    "def_blitz_rate": True,
    "def_pressure_rate": True,
}


def unit_metrics(prefix: str, ps: list[Play], drives: list[dict[str, Any]]) -> dict[str, Any]:
    drop = [p for p in ps if p.is_pass]
    runs = [p for p in ps if not p.is_pass]
    third = [p for p in ps if p.down == 3]
    rz = [d for d in drives if d["rz"]]
    m = {
        "epa_per_play": fmean(p.epa for p in ps),
        "pass_epa": fmean(p.epa for p in drop),
        "run_epa": fmean(p.epa for p in runs),
        "success_rate": rate(ps, lambda p: p.success),
        "explosive_rate": rate(ps, lambda p: p.explosive),
        "third_down_conv_rate": rate(third, lambda p: p.first_down),
        "red_zone_td_rate": sum(d["td"] for d in rz) / len(rz) if rz else None,
    }
    return {f"{prefix}_{k}": v for k, v in m.items()}


def build_team_season(
    season: int,
    teams: list[str],
    plays: list[Play],
    drives: list[dict[str, Any]],
    games: list[Game],
) -> list[dict[str, Any]]:
    blitz = season in BLITZ_SEASONS
    charted = season in PARTICIPATION_SEASONS
    rows = []
    for team in [*teams, "NFL"]:
        league = team == "NFL"
        off = plays if league else [p for p in plays if p.offense == team]
        dfn = plays if league else [p for p in plays if p.defense == team]
        odr = drives if league else [d for d in drives if d["offense"] == team]
        ddr = drives if league else [d for d in drives if d["defense"] == team]
        n_games = len(games) if league else sum(team in (g.home, g.away) for g in games)
        early = [p for p in off if p.down <= 2]
        ddrop = [p for p in dfn if p.is_pass]
        row: dict[str, Any] = {
            "season": season,
            "team": team,
            "games": n_games,
            "off_plays": len(off),
        }
        om = unit_metrics("off", off, odr)
        row.update(
            {
                k: om[f"off_{k.removeprefix('off_')}"]
                for k in (
                    "off_epa_per_play",
                    "off_pass_epa",
                    "off_run_epa",
                    "off_success_rate",
                    "off_explosive_rate",
                )
            }
        )
        row["off_pass_rate"] = rate(off, lambda p: p.is_pass)
        row["off_proe"] = fmean(float(p.is_pass) - p.xpass for p in off)
        row["off_early_down_pass_rate"] = rate(early, lambda p: p.is_pass)
        row["off_third_down_conv_rate"] = om["off_third_down_conv_rate"]
        row["off_red_zone_td_rate"] = om["off_red_zone_td_rate"]
        row["def_plays"] = len(dfn)
        row.update(unit_metrics("def", dfn, ddr))
        row["def_blitz_rate"] = rate(ddrop, lambda p: p.blitz) if blitz else None
        row["def_pressure_rate"] = rate(ddrop, lambda p: p.pressure) if charted else None
        rows.append({k: (r4(v) if isinstance(v, float) else v) for k, v in row.items()})
    for metric, high_is_1 in RANK_HIGH_IS_1.items():
        vals = [(r[metric], r) for r in rows if r["team"] != "NFL" and r[metric] is not None]
        for r in rows:
            r[f"rank_{metric}"] = None
        for v, r in vals:
            better = sum(1 for w, _ in vals if (w > v if high_is_1 else w < v))
            r[f"rank_{metric}"] = better + 1  # min-rank ties
    return rows


def build_players(
    season: int, rosters: dict[str, Roster], plays: list[Play]
) -> list[dict[str, Any]]:
    by_passer: dict[str, list[Play]] = defaultdict(list)
    by_rusher: dict[str, list[Play]] = defaultdict(list)
    by_target: dict[str, list[Play]] = defaultdict(list)
    team_targets: dict[str, int] = defaultdict(int)
    team_air: dict[str, float] = defaultdict(float)
    for p in plays:
        if p.passer:
            by_passer[p.passer].append(p)
        if p.rusher:
            by_rusher[p.rusher].append(p)
        if p.receiver:
            by_target[p.receiver].append(p)
            team_targets[p.offense] += 1
            team_air[p.offense] += p.air_yards or 0.0
    rows = []
    for team, roster in sorted(rosters.items()):
        players = {pl.player_id: pl for pl in roster.qb}
        players.update({pl.player_id: pl for pl, _ in roster.rushers + roster.targets})
        for pid, pl in sorted(
            players.items(), key=lambda kv: ("QBRBWRTE".index(kv[1].position), kv[0])
        ):
            dropbacks, rushes, targets = by_passer[pid], by_rusher[pid], by_target[pid]
            if not (dropbacks or rushes or targets):
                continue
            row: dict[str, Any] = {
                "season": season,
                "player_id": pid,
                "player_name": pl.name,
                "team": team,
                "position": pl.position,
                "games": len({p.game_id for p in dropbacks + rushes + targets}),
            }
            att = [p for p in dropbacks if not p.sack]
            sacks = [p for p in dropbacks if p.sack]
            if dropbacks:
                yds = sum(p.yards for p in att if p.complete)
                td = sum(p.touchdown for p in att)
                ints = sum(p.interception for p in att)
                row.update(
                    {
                        "pass_att": len(att),
                        "completions": sum(p.complete for p in att),
                        "pass_yds": yds,
                        "pass_td": td,
                        "interceptions": ints,
                        "sacks": len(sacks),
                        "epa_per_dropback": r4(fmean(p.epa for p in dropbacks)),
                        "cpoe": r4(fmean(100 * (float(p.complete) - (p.cp or 0)) for p in att))
                        if att
                        else None,
                        "any_a": r4(
                            (yds + 20 * td - 45 * ints + sum(p.yards for p in sacks))
                            / len(dropbacks)
                        ),
                    }
                )
            else:
                row.update(
                    dict.fromkeys(
                        (
                            "pass_att",
                            "completions",
                            "pass_yds",
                            "pass_td",
                            "interceptions",
                            "sacks",
                            "epa_per_dropback",
                            "cpoe",
                            "any_a",
                        )
                    )
                )
            if rushes:
                row.update(
                    {
                        "rush_att": len(rushes),
                        "rush_yds": sum(p.yards for p in rushes),
                        "rush_td": sum(p.touchdown for p in rushes),
                        "epa_per_rush": r4(fmean(p.epa for p in rushes)),
                        "rush_success_rate": r4(rate(rushes, lambda p: p.success)),
                    }
                )
            else:
                row.update(
                    dict.fromkeys(
                        ("rush_att", "rush_yds", "rush_td", "epa_per_rush", "rush_success_rate")
                    )
                )
            if targets:
                rec = [p for p in targets if p.complete]
                air = sum(p.air_yards or 0.0 for p in targets)
                row.update(
                    {
                        "targets": len(targets),
                        "receptions": len(rec),
                        "rec_yds": sum(p.yards for p in rec),
                        "rec_td": sum(p.touchdown for p in rec),
                        "epa_per_target": r4(fmean(p.epa for p in targets)),
                        "target_share": r4(len(targets) / team_targets[team]),
                        "air_yards_share": r4(air / team_air[team]) if team_air[team] else None,
                        "yac_per_rec": r4(fmean(p.yards - (p.air_yards or 0) for p in rec))
                        if rec
                        else None,
                    }
                )
            else:
                row.update(
                    dict.fromkeys(
                        (
                            "targets",
                            "receptions",
                            "rec_yds",
                            "rec_td",
                            "epa_per_target",
                            "target_share",
                            "air_yards_share",
                            "yac_per_rec",
                        )
                    )
                )
            rows.append(row)
    return rows


# --------------------------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------------------------
@dataclass
class Fixtures:
    schedule: list[dict[str, Any]]
    team_week: list[dict[str, Any]]
    team_season: list[dict[str, Any]]
    team_tendencies: list[dict[str, Any]]
    player_season: list[dict[str, Any]]
    optional_fields_by_season: dict[str, list[int]]


def schedule_row(g: Game) -> dict[str, Any]:
    return {
        "game_id": g.game_id,
        "season": g.season,
        "week": g.week,
        "game_type": g.game_type,
        "gameday": g.gameday.isoformat(),
        "gametime": g.gametime,
        "home_team": g.home,
        "away_team": g.away,
        "home_score": g.home_score,
        "away_score": g.away_score,
        "stadium": g.stadium,
        "spread_line": g.spread_line,
        "total_line": g.total_line,
    }


def generate() -> Fixtures:
    rng = random.Random(SEED)
    teams_meta = json.loads(TEAMS_JSON.read_text())
    teams = [t["abbr"] for t in teams_meta]
    profiles = make_profiles(rng, teams)
    rosters = make_rosters(rng, teams)
    sim = Simulator(rng, profiles, rosters)
    fx = Fixtures([], [], [], [], [], {})
    for season in SEASONS:
        games = regular_schedule(rng, season, teams, profiles[season])
        played = [g for g in games if season != CURRENT_SEASON or g.week < CURRENT_WEEK]
        plays_by_game = {g.game_id: sim.play_game(g) for g in played}
        if season in POSTSEASON:
            games += play_postseason(
                season, played, teams_meta, profiles[season], sim, plays_by_game
            )
        # League-centre EPA per season so EPA/play averages ~0 like nflverse.
        all_plays = [
            p for g in games if g.game_id in plays_by_game for p in plays_by_game[g.game_id]
        ]
        shift = fmean(p.epa for p in all_plays)
        for p in all_plays:
            p.epa -= shift
        reg_plays = [p for p in all_plays if p.season_type == "REG"]
        reg_games = [g for g in played if g.game_type == "REG"]
        reg_drives = [d for d in sim.drives if d["season"] == season and d["season_type"] == "REG"]
        fx.schedule += [schedule_row(g) for g in games]
        for g in games:
            if g.game_id in plays_by_game:
                fx.team_week += game_rows(g, plays_by_game[g.game_id])
        fx.team_season += build_team_season(season, teams, reg_plays, reg_drives, reg_games)
        fx.team_tendencies += build_tendencies(season, reg_plays)
        fx.player_season += build_players(season, rosters, reg_plays)
    every = list(SEASONS)
    blitz = sorted(BLITZ_SEASONS)
    charted = sorted(PARTICIPATION_SEASONS)
    fx.optional_fields_by_season = {
        "proe": every,
        "avg_air_yards": every,
        "deep_pass_rate": every,
        "screen_rate": every,
        "play_action_rate": every,
        "blitz_rate": blitz,
        "pressure_rate": charted,
        "man_rate": charted,
        "zone_rate": charted,
        "off_proe": every,
        "def_blitz_rate": blitz,
        "def_pressure_rate": charted,
        "cpoe": every,
    }
    return fx


def write(fx: Fixtures, out: Path = FIXTURE_DATA_DIR) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name in ("schedule", "team_week", "team_season", "team_tendencies", "player_season"):
        write_rows(name, getattr(fx, name), out)
    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": GENERATED_AT,
        "stats_as_of": STATS_AS_OF,
        "current_season": CURRENT_SEASON,
        "current_week": CURRENT_WEEK,
        "seasons": list(SEASONS),
        "files": {},
        "optional_fields_by_season": fx.optional_fields_by_season,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    # Fill `files` from a real mock write so the fixture manifest is schema-valid and accurate.
    with tempfile.TemporaryDirectory() as tmp:
        manifest = mock.write_data(Path(tmp))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    write(generate())


if __name__ == "__main__":
    main()
