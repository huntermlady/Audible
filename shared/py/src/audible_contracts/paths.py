"""Locations of the shared/ contract files, resolved from this package's position in the repo."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SHARED_DIR = REPO_ROOT / "shared"
SCHEMAS_DIR = SHARED_DIR / "schemas"
FIXTURES_DIR = SHARED_DIR / "fixtures"
FIXTURE_DATA_DIR = FIXTURES_DIR / "data"
FIXTURE_REPORTS_DIR = FIXTURES_DIR / "reports"
SCENARIOS_DIR = SHARED_DIR / "scenarios"
TEAMS_JSON = SHARED_DIR / "teams.json"
