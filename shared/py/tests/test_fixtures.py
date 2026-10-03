"""Every committed fixture validates against its schema (jsonschema + pydantic), consistently."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import BaseModel
from referencing import Registry, Resource

from audible_contracts import models
from audible_contracts.fixtures import PARQUET_TABLES, load_manifest, load_rows
from audible_contracts.fixtures_gen import GROUPINGS, cell_key
from audible_contracts.paths import FIXTURE_REPORTS_DIR, SCENARIOS_DIR, SCHEMAS_DIR, TEAMS_JSON

TABLE_SCHEMAS = {
    "schedule": ("schedule_game.schema.json", models.ScheduleGame),
    "team_week": ("team_week_row.schema.json", models.TeamWeekRow),
    "team_season": ("team_season_row.schema.json", models.TeamSeasonRow),
    "team_tendencies": ("team_tendency_row.schema.json", models.TeamTendencyRow),
    "player_season": ("player_season_row.schema.json", models.PlayerSeasonRow),
}


def _registry() -> Registry:
    resources = []
    for path in SCHEMAS_DIR.glob("*.schema.json"):
        doc = json.loads(path.read_text())
        resource = Resource.from_contents(doc)
        resources += [(doc["$id"], resource), (path.name, resource)]
    return Registry().with_resources(resources)


REGISTRY = _registry()


def validator(schema_file: str) -> Draft202012Validator:
    schema = json.loads((SCHEMAS_DIR / schema_file).read_text())
    return Draft202012Validator(schema, registry=REGISTRY, format_checker=FormatChecker())


def assert_valid(schema_file: str, model: type[BaseModel], items: list[Any]) -> None:
    v = validator(schema_file)
    for i, item in enumerate(items):
        errors = sorted(v.iter_errors(item), key=str)
        assert not errors, f"{schema_file}[{i}]: {errors[0].message} at {list(errors[0].path)}"
        model.model_validate(item)


def test_schemas_are_valid_2020_12() -> None:
    for path in SCHEMAS_DIR.glob("*.schema.json"):
        doc = json.loads(path.read_text())
        Draft202012Validator.check_schema(doc)
        assert doc["$schema"] == "https://json-schema.org/draft/2020-12/schema"


def test_nullable_fields_are_required() -> None:
    """CONTRACTS §4: nullable = key present, value may be null."""

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                assert set(node["required"]) == set(node["properties"]), node.get("title")
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for path in SCHEMAS_DIR.glob("*.schema.json"):
        walk(json.loads(path.read_text()))


@pytest.mark.parametrize("table", list(TABLE_SCHEMAS))
def test_data_tables_validate(table: str) -> None:
    schema_file, model = TABLE_SCHEMAS[table]
    rows = load_rows(table)
    assert rows
    assert_valid(schema_file, model, rows)


def test_manifest_validates() -> None:
    assert_valid("manifest.schema.json", models.Manifest, [load_manifest()])


def test_teams_validate() -> None:
    teams = json.loads(TEAMS_JSON.read_text())
    assert_valid("team.schema.json", models.Team, teams)
    assert len({t["abbr"] for t in teams}) == 32
    assert Counter(t["division"] for t in teams) == {d: 4 for d in {t["division"] for t in teams}}


def test_team_logo_urls_are_https() -> None:
    """CONTRACT_CHANGES #17: hotlinked nflverse URLs; refresh with update_team_logos."""
    for t in json.loads(TEAMS_JSON.read_text()):
        for key in ("logo_url", "wordmark_url"):
            assert t[key] and t[key].startswith("https://"), (t["abbr"], key)
        assert t["logo_url"].endswith(".png") and t["wordmark_url"].endswith(".png"), t["abbr"]


def test_no_image_files_committed() -> None:
    """Logos are URLs only; no image files anywhere under shared/."""
    images = [p for ext in ("png", "jpg", "jpeg", "svg", "gif", "webp")
              for p in SCHEMAS_DIR.parent.rglob(f"*.{ext}")]
    assert not images, images


def test_reports_validate() -> None:
    index = json.loads((FIXTURE_REPORTS_DIR / "index.json").read_text())
    assert_valid("report_index_entry.schema.json", models.ReportIndexEntry, index)
    for entry in index:
        report = json.loads((FIXTURE_REPORTS_DIR / entry["path"]).read_text())
        assert_valid("game_plan_report.schema.json", models.GamePlanReport, [report])
        for key in ("season", "week", "game_id", "team", "opponent", "role", "model"):
            assert report[key] == entry[key]


def test_playcaller_samples_validate() -> None:
    samples = json.loads((FIXTURE_REPORTS_DIR / "samples" / "playcaller.json").read_text())
    assert 3 <= len(samples) <= 5
    assert_valid("playcaller_sample.schema.json", models.PlaycallerSample, samples)


def test_scenarios_validate() -> None:
    files = sorted(SCENARIOS_DIR.glob("*.json"))
    scenarios = [json.loads(p.read_text()) for p in files]
    assert_valid("scenario.schema.json", models.Scenario, scenarios)
    assert [s["id"] for s in scenarios] == [p.stem for p in files]
    assert Counter(s["situation"]["role"] for s in scenarios) == {"OC": 6, "DC": 6}
    for s in scenarios:
        sit = s["situation"]
        assert sit["distance"] <= sit["yardline_100"], s["id"]
        assert s["id"].startswith(sit["role"].lower())


# --- consistency ------------------------------------------------------------------------------
def call_texts(call: dict[str, Any]) -> list[str]:
    texts = [r["text"] for r in call["rationale"]] + call["caveats"]
    options = [call["primary"], *call["alternatives"]]
    return texts + [o["concept"] for o in options] + [o.get("when", "") for o in options]


def assert_grounded(texts: list[str], fs: dict[str, Any], sit: dict[str, Any] | None) -> None:
    """Uses T2's validator (SPEC §11), the same check the report job and the web app apply."""
    grounding = pytest.importorskip("audible_ai.grounding")
    for text in texts:
        result = grounding.check_grounding(text, fs, sit)
        assert result.grounded, f"ungrounded {result.ungrounded} in {text!r}"


def assert_cited(call: dict[str, Any], fs: dict[str, Any]) -> None:
    ids = {f["id"] for f in fs["facts"]}
    for item in call["rationale"]:
        assert set(item["stat_ids"]) <= ids, item


def test_mock_ai_outputs_are_grounded_and_cite_real_facts() -> None:
    for path in (FIXTURE_REPORTS_DIR / "2026").rglob("*.json"):
        r = json.loads(path.read_text())
        fs = r["fact_sheet"]
        texts = [r["headline"]] + [k["title"] + " " + k["detail"] for k in r["keys"]]
        for call in r["situational_calls"].values():
            texts += call_texts(call)
            assert_cited(call, fs)
            assert call["role"] == r["role"]
        for k in r["keys"]:
            assert set(k["stat_ids"]) <= {f["id"] for f in fs["facts"]}
        assert_grounded(texts, fs, None)
    samples = json.loads((FIXTURE_REPORTS_DIR / "samples" / "playcaller.json").read_text())
    for s in samples:
        assert_cited(s["call"], s["fact_sheet"])
        assert_grounded(call_texts(s["call"]), s["fact_sheet"], s["situation"])
        assert s["fact_sheet"]["context"]["situation"] == s["situation"]


def test_mock_facts_match_fixture_tendencies() -> None:
    rows = {
        (r["team"], r["side"], r["season"], r["grouping"], r["cell_key"]): r
        for r in load_rows("team_tendencies")
    }
    reports = [json.loads(p.read_text()) for p in (FIXTURE_REPORTS_DIR / "2026").rglob("*.json")]
    samples = json.loads((FIXTURE_REPORTS_DIR / "samples" / "playcaller.json").read_text())
    for fs in [r["fact_sheet"] for r in reports] + [s["fact_sheet"] for s in samples]:
        for f in fs["facts"]:
            team, side, season, grouping, key, metric = f["id"].split(".")
            row = rows[(team, side, int(season), grouping, key)]
            assert f["value"] == pytest.approx(row[metric], abs=1e-4)
            assert f["n"] == row["plays"] and f["low_sample"] == row["low_sample"]
            league = rows[("NFL", "off", int(season), grouping, key)]
            assert f["league_value"] == pytest.approx(league[metric], abs=1e-4)


def test_tendency_cells_are_consistent() -> None:
    rows = load_rows("team_tendencies")
    for r in rows:
        dims = {d: r[d] for d in ("down", "dist_bucket", "field_zone", "score_state",
                                  "time_bucket") if r[d] is not None}
        assert tuple(k for k in dims) == tuple(
            d for d in ("down", "dist_bucket", "field_zone", "score_state", "time_bucket")
            if d in GROUPINGS[r["grouping"]]
        ), r
        assert r["cell_key"] == cell_key(dims)
        assert "." not in r["cell_key"]
        assert r["low_sample"] == (r["plays"] < 20)
        if r["team"] == "NFL":
            assert r["side"] == "off"
        for group in (("run_left_rate", "run_middle_rate", "run_right_rate"),
                      ("pass_left_rate", "pass_middle_rate", "pass_right_rate")):
            vals = [r[c] for c in group]
            if vals[0] is not None:
                assert sum(vals) == pytest.approx(1, abs=2e-4)
        if r["man_rate"] is not None:
            assert r["man_rate"] + r["zone_rate"] == pytest.approx(1, abs=2e-4)
        if r["pass_epa"] is not None and r["run_epa"] is not None:
            blended = r["pass_rate"] * r["pass_epa"] + (1 - r["pass_rate"]) * r["run_epa"]
            assert blended == pytest.approx(r["epa_per_play"], abs=2e-3)
    # Overall = sum of down_dist cells, per team/side/season.
    totals: Counter[tuple[str, str, int, str]] = Counter()
    for r in rows:
        if r["grouping"] in ("overall", "down_dist", "zone", "score_time"):
            totals[(r["team"], r["side"], r["season"], r["grouping"])] += r["plays"]
    for (team, side, season, grouping), n in totals.items():
        assert n == totals[(team, side, season, "overall")], (team, side, season, grouping)
    # Every grouping present, low-sample cells present, charted fields null only in 2025.
    assert {r["grouping"] for r in rows} == set(GROUPINGS)
    assert any(r["low_sample"] for r in rows)
    # Optional coverage mirrors real data: blitz both seasons; participation fields null in 2026.
    optional = load_manifest()["optional_fields_by_season"]
    for field in ("blitz_rate", "pressure_rate", "man_rate", "zone_rate"):
        for season in (2025, 2026):
            present = [r[field] is not None for r in rows if r["season"] == season]
            if season in optional[field]:
                assert any(present), (field, season)
            else:
                assert not any(present), (field, season)
    assert "pressure_rate" in optional and 2026 not in optional["pressure_rate"]


def test_team_season_ranks_and_league_rows() -> None:
    rows = load_rows("team_season")
    manifest = load_manifest()
    for season in manifest["seasons"]:
        season_rows = [r for r in rows if r["season"] == season]
        assert len(season_rows) == 33
        nfl = next(r for r in season_rows if r["team"] == "NFL")
        assert all(v is None for k, v in nfl.items() if k.startswith("rank_"))
        teams = [r for r in season_rows if r["team"] != "NFL"]
        for rank_col in (k for k in nfl if k.startswith("rank_")):
            metric = rank_col.removeprefix("rank_")
            ranked = [r for r in teams if r[metric] is not None]
            assert all(r[rank_col] is None for r in teams if r[metric] is None)
            if ranked:
                assert min(r[rank_col] for r in ranked) == 1
        # Rank direction spot checks (CONTEXT.md).
        best_off = min(teams, key=lambda r: r["rank_off_epa_per_play"])
        assert best_off["off_epa_per_play"] == max(r["off_epa_per_play"] for r in teams)
        best_def = min(teams, key=lambda r: r["rank_def_epa_per_play"])
        assert best_def["def_epa_per_play"] == min(r["def_epa_per_play"] for r in teams)
    # Plausibility: tight for full seasons, looser for the 3-game current season.
    for r in rows:
        partial = r["season"] == manifest["current_season"]
        epa, lo, hi = (0.4, 0.3, 0.66) if partial else (0.32, 0.34, 0.6)
        assert -epa < r["off_epa_per_play"] < epa
        assert -epa < r["def_epa_per_play"] < epa
        assert lo < r["off_success_rate"] < hi
        assert 0.42 < r["off_pass_rate"] < 0.78


def test_schedule_and_manifest_week() -> None:
    games = load_rows("schedule")
    manifest = load_manifest()
    cur = manifest["current_season"]
    unplayed = [g["week"] for g in games if g["season"] == cur and g["home_score"] is None]
    assert manifest["current_week"] == min(unplayed) == 4
    assert any(g["game_id"] == "2026_04_KC_BAL" for g in games)
    assert {g["season"] for g in games} == set(manifest["seasons"])
    for season in manifest["seasons"]:
        reg = [g for g in games if g["season"] == season and g["game_type"] == "REG"]
        per_team = Counter(t for g in reg for t in (g["home_team"], g["away_team"]))
        assert set(per_team.values()) == {17}
    for g in games:
        assert g["game_id"] == f"{g['season']}_{g['week']:02d}_{g['away_team']}_{g['home_team']}"
        assert (g["home_score"] is None) == (g["away_score"] is None)


def test_team_week_matches_schedule() -> None:
    games = {g["game_id"]: g for g in load_rows("schedule")}
    rows = load_rows("team_week")
    played = [g for g in games.values() if g["home_score"] is not None]
    assert len(rows) == 2 * len(played)
    for r in rows:
        g = games[r["game_id"]]
        pf = g["home_score"] if r["is_home"] else g["away_score"]
        assert r["points_for"] == pf


def test_player_counts_per_season() -> None:
    rows = load_rows("player_season")
    for season in (2025, 2026):
        counts = Counter(r["position"] for r in rows if r["season"] == season)
        # Rosters are 40/70/110/60; a deep reserve can go untouched in a 3-game season.
        for position, rostered in {"QB": 40, "RB": 70, "WR": 110, "TE": 60}.items():
            assert rostered - 4 <= counts[position] <= rostered, (season, position)
    for r in rows:
        if r["pass_att"] is None:
            assert r["completions"] is None and r["any_a"] is None
        if r["targets"] is None:
            assert r["receptions"] is None and r["target_share"] is None


def test_every_table_is_listed() -> None:
    assert set(PARQUET_TABLES) | {"schedule"} == set(TABLE_SCHEMAS)
    assert Path(TEAMS_JSON).exists()


def test_committed_fixtures_match_generator() -> None:
    """Fixtures are generated: re-run `python -m audible_contracts.fixtures_gen` after changes."""
    from audible_contracts import fixtures_gen

    fx = fixtures_gen.generate()
    for table in TABLE_SCHEMAS:
        assert getattr(fx, table) == load_rows(table), f"{table} is stale"
    assert fx.optional_fields_by_season == load_manifest()["optional_fields_by_season"]
