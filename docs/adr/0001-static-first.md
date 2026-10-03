# ADR 0001: Static-first architecture

- **Status:** Accepted (2026-09-25); amended by [ADR 0005](0005-cloud-live-mode.md): an optional, stateless Cloudflare Worker serves visitor live AI
- **Deciders:** owner; build plan §1–2

## Context

Audible is a single-user portfolio app that must be publicly demoable at no cost, with no server to
run or secure. The data is public and changes slowly: nflverse play-by-play updates at most daily,
and AI game plans are weekly. The expensive work (ingest, bucketing, aggregation, LLM calls) can be
done ahead of time. The interactive part (filtering, sorting, charting) works on small precomputed
aggregates.

## Decision

Ship a **static site on GitHub Pages** with no backend:

- A Python pipeline (`pipeline/`) runs nightly in GitHub Actions and writes precomputed aggregates
  (zstd Parquet + JSON + `manifest.json`) to `data/`. That output is deployed with the site and is
  never committed.
- AI game-plan reports are generated weekly on the owner's Mac and committed to `reports/` as JSON.
- The React app (Vite, `base: /Audible/`) reads those files in the browser (see ADR 0003). Deep links
  work because `404.html` is a copy of `index.html`.
- `deploy.yml` builds the site, copies in `data/` and `reports/`, and publishes it with
  `actions/deploy-pages`.

## Consequences

- There's no hosting cost, no auth, and no server attack surface. Secrets never reach the browser:
  the Claude path exists only on the Vite dev server, and CI fails if a trace of it reaches `dist/`.
- Everything the site shows has to be precomputed and small enough to download. The site must stay
  under 150 MB (deploy asserts this) and `data/` under 75 MB (nightly asserts this). Only aggregates
  ship, never raw play-by-play.
- Freshness is bounded by the schedules: stats are at most a day old in season, and reports are weekly
  and go visibly stale if the Mac job misses a week.
- Live AI can't run on a server. It runs on the visitor's own machine, or not at all (ADR 0004).
- Anything that needs a server would require revisiting this decision: accounts, live in-game data,
  or a hosted LLM for visitors.
