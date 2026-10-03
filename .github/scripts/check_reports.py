"""Fail if reports/ holds mock or fake game plans (used by deploy.yml and weekly-reports.yml).

reports/ on main must hold only real batch-job output. Mock reports live in shared/fixtures and
are copied into reports/ by `make mock-data` for local work; they must never ship.
Usage: python3 .github/scripts/check_reports.py [reports_dir]
"""

import hashlib
import json
import pathlib
import sys

FIXTURES = pathlib.Path("shared/fixtures/reports")


def digest(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def records(doc: object) -> list[dict]:
    if isinstance(doc, list):
        return [r for r in doc if isinstance(r, dict)]
    return [doc] if isinstance(doc, dict) else []


def main() -> int:
    reports = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "reports")
    fixture_hashes = {digest(p): p for p in FIXTURES.rglob("*.json")}
    files = sorted(reports.rglob("*.json")) if reports.exists() else []
    bad = []
    for path in files:
        h = digest(path)
        if h in fixture_hashes:
            bad.append(f"{path}: byte-identical to {fixture_hashes[h]}")
            continue
        try:
            doc = json.loads(path.read_text())
        except ValueError as e:
            bad.append(f"{path}: not valid JSON ({e})")
            continue
        for rec in records(doc):
            if rec.get("provider") == "fake":
                bad.append(f"{path}: provider == 'fake' (test-only provider)")
            if rec.get("model") == "fixture-mock":
                bad.append(f"{path}: model == 'fixture-mock' (a shared/fixtures mock report)")
    if bad:
        print(f"::error::{reports}/ contains mock or fake reports; remove them "
              f"(git rm -r {reports}/) and let the weekly job regenerate real ones.")
        print("\n".join(sorted(set(bad))))
        return 1
    print(f"{reports}/ OK ({len(files)} JSON files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
