from __future__ import annotations

import json

import pytest

from audible_ai import reports, schemas
from audible_ai.providers.fake import FakeProvider
from audible_contracts.paths import FIXTURE_DATA_DIR

from .helpers import ScriptedProvider, result

GAME = "2026_04_KC_BAL"


def _fake_enum_ready() -> bool:
    return "fake" in schemas.load("game_plan_report")["properties"]["provider"]["enum"]


needs_fake_enum = pytest.mark.skipif(not _fake_enum_ready(),
                                     reason="game_plan_report provider enum lacks 'fake' (t0)")


@needs_fake_enum
def test_run_writes_four_valid_reports_and_index(tmp_path):
    summary = reports.run(FakeProvider(), 4, data_dir=FIXTURE_DATA_DIR, out_dir=tmp_path,
                          games_filter=lambda g: g["game_id"] == GAME)
    assert (summary.season, summary.week, summary.games) == (2026, 4, 1)
    assert len(summary.written) == 4 and summary.failed == []
    index = json.loads((tmp_path / "index.json").read_text())
    assert len(index) == 4
    for entry in index:
        assert schemas.errors("report_index_entry", entry) == []
        report = json.loads((tmp_path / entry["path"]).read_text())
        assert schemas.errors("game_plan_report", report) == []
        assert report["validation_status"] == "passed"
        assert entry["path"].startswith("2026/4/2026_04_KC_BAL.")
    roles = sorted((e["team"], e["role"]) for e in index)
    assert roles == [("BAL", "DC"), ("BAL", "OC"), ("KC", "DC"), ("KC", "OC")]
    samples = json.loads((tmp_path / "samples" / "playcaller.json").read_text())
    assert 3 <= len(samples) <= 5
    for s in samples:
        assert schemas.errors("playcaller_sample", s) == []


@needs_fake_enum
def test_index_merges_with_existing_entries(tmp_path):
    other = {"season": 2026, "week": 3, "game_id": "2026_03_KC_NYJ", "team": "KC",
             "opponent": "NYJ", "role": "OC", "path": "2026/3/2026_03_KC_NYJ.KC.OC.json",
             "generated_at": "2026-09-15T03:00:00Z", "stats_as_of": "2026-09-14",
             "model": "qwen3:8b", "validation_status": "passed"}
    (tmp_path / "index.json").write_text(json.dumps([other]))
    for _ in range(2):  # re-running the same week replaces, never duplicates
        reports.run(FakeProvider(), 4, data_dir=FIXTURE_DATA_DIR, out_dir=tmp_path,
                    games_filter=lambda g: g["game_id"] == GAME, with_samples=False)
    index = json.loads((tmp_path / "index.json").read_text())
    assert len(index) == 5 and index[0] == other


def test_failed_validation_writes_failed_schema_valid_report(tmp_path):
    provider = ScriptedProvider([result(None, "garbage")] * 8)
    summary = reports.run(provider, 4, data_dir=FIXTURE_DATA_DIR, out_dir=tmp_path,
                          games_filter=lambda g: g["game_id"] == GAME, with_samples=False)
    assert summary.written == [] and len(summary.failed) == 4
    assert len(provider.requests) == 8  # one retry per report
    for entry in json.loads((tmp_path / "index.json").read_text()):
        assert entry["validation_status"] == "failed"
        report = json.loads((tmp_path / entry["path"]).read_text())
        assert schemas.errors("game_plan_report", report) == []


@needs_fake_enum
def test_retry_then_pass(tmp_path):
    summary = reports.run(FakeProvider(fail_first=True), 4, data_dir=FIXTURE_DATA_DIR,
                          out_dir=tmp_path, games_filter=lambda g: g["game_id"] == GAME,
                          with_samples=False)
    assert len(summary.written) == 4


def test_resolve_week_auto():
    assert reports.resolve_week("auto", {"current_season": 2026, "current_week": 4}) == (2026, 4)
    assert reports.resolve_week(7, {"current_season": 2026, "current_week": 4}) == (2026, 7)


@needs_fake_enum
def test_skip_existing_keeps_passed_reports_and_index_is_incremental(tmp_path):
    reports.run(FakeProvider(), 4, data_dir=FIXTURE_DATA_DIR, out_dir=tmp_path,
                games_filter=lambda g: g["game_id"] == GAME, with_samples=False)
    kept = tmp_path / "2026/4/2026_04_KC_BAL.KC.OC.json"
    before = kept.read_text()
    (tmp_path / "2026/4/2026_04_KC_BAL.BAL.DC.json").write_text("{}")  # corrupt → regenerated
    (tmp_path / "index.json").write_text("[]")  # as after a hard kill
    provider = FakeProvider()
    summary = reports.run(provider, 4, data_dir=FIXTURE_DATA_DIR, out_dir=tmp_path,
                          games_filter=lambda g: g["game_id"] == GAME, with_samples=False,
                          skip_existing=True)
    assert len(summary.skipped) == 3 and summary.written == ["2026/4/2026_04_KC_BAL.BAL.DC.json"]
    assert provider.calls == 1 and kept.read_text() == before
    assert len(json.loads((tmp_path / "index.json").read_text())) == 4
