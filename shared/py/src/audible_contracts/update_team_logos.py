"""Refresh `logo_url` / `wordmark_url` in shared/teams.json from nflverse (CONTRACT_CHANGES #17).

    uv run python -m audible_contracts.update_team_logos [--check]

URLs only: the images are hotlinked by the web app and never committed. `--check` also fetches
every URL and fails unless each returns HTTP 200. nflverse's teams table uses the same pbp
abbreviations as teams.json (Rams = `LA`; historical rows such as LAR/OAK/SD/STL are ignored).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from audible_contracts.paths import TEAMS_JSON

LOGO_COLUMN = "team_logo_espn"
WORDMARK_COLUMN = "team_wordmark"
USER_AGENT = "audible-team-logos/1.0 (+https://github.com/huntermlady/Audible)"


def nflverse_urls() -> dict[str, tuple[str | None, str | None]]:
    """abbr -> (logo_url, wordmark_url) from nflreadpy.load_teams()."""
    import nflreadpy  # pipeline dependency; available in the uv workspace venv

    teams = nflreadpy.load_teams()
    return {
        row["team_abbr"]: (row[LOGO_COLUMN] or None, row[WORDMARK_COLUMN] or None)
        for row in teams.select(["team_abbr", LOGO_COLUMN, WORDMARK_COLUMN]).iter_rows(named=True)
    }


def with_urls(team: dict[str, Any], logo: str | None, wordmark: str | None) -> dict[str, Any]:
    """The team with the URL keys placed right after `logo` (schema property order)."""
    out: dict[str, Any] = {}
    for key, value in team.items():
        if key in ("logo_url", "wordmark_url"):
            continue
        out[key] = value
        if key == "logo":
            out["logo_url"], out["wordmark_url"] = logo, wordmark
    return out


def status(url: str) -> int | str:
    """Final HTTP status after redirects (HEAD), or the network error's text."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return f"error: {err}"


def check_urls(teams: list[dict[str, Any]]) -> list[str]:
    """Fetch every URL in parallel; returns a line per URL that isn't HTTP 200."""
    urls = [(t["abbr"], u) for t in teams for u in (t["logo_url"], t["wordmark_url"])]
    with ThreadPoolExecutor(max_workers=16) as pool:
        codes = list(pool.map(lambda pair: status(pair[1]) if pair[1] else None, urls))
    return [f"{abbr}: {url} -> {code}" for (abbr, url), code in zip(urls, codes, strict=True)
            if code != 200]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refresh team logo URLs in shared/teams.json.")
    parser.add_argument("--check", action="store_true", help="fail unless every URL returns 200")
    args = parser.parse_args(argv)

    teams = json.loads(TEAMS_JSON.read_text())
    urls = nflverse_urls()
    missing = [t["abbr"] for t in teams if t["abbr"] not in urls]
    if missing:
        print(f"nflverse has no row for: {', '.join(missing)}", file=sys.stderr)
        return 1
    teams = [with_urls(t, *urls[t["abbr"]]) for t in teams]
    TEAMS_JSON.write_text(json.dumps(teams, indent=2) + "\n")
    print(f"Updated {len(teams)} teams in {TEAMS_JSON}")

    if args.check:
        bad = check_urls(teams)
        for line in bad:
            print(line, file=sys.stderr)
        if bad:
            return 1
        print("All URLs returned HTTP 200")
    return 0


if __name__ == "__main__":
    sys.exit(main())
