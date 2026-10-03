# ADR 0003: DuckDB-WASM for in-browser queries

- **Status:** Accepted (2026-09-25); bundle detail added at deploy (2026-09-26)
- **Deciders:** owner; build plan §2, §4.3

## Context

With no server (ADR 0001), the browser has to filter, join, and rank the aggregates itself: team
season and week stats, tendency cells by down, distance, field zone, score, and time, and player
seasons, across 6 seasons. Hand-written JS over JSON would mean re-implementing group-bys and ranks per
page, and shipping everything as JSON is several times larger than zstd Parquet.

## Decision

Use **`@duckdb/duckdb-wasm`**, a single instance in a Web Worker, behind typed TanStack Query hooks
(`web/src/data`). Pages never touch SQL or files directly.

- The app loads `manifest.json` first, then **lazily registers each Parquet file on first use**.
  Each page fetches only the tables it queries (for example, `/players` never downloads
  `team_tendencies.parquet`). The Playwright suite asserts this.
- **EH bundle only** (wasm exception handling). All current browsers support it. Dropping the MVP
  bundle keeps about 41 MB out of `dist/`. Browsers without wasm EH get the data error state.
- DuckDB is dynamically imported, so it stays out of the entry chunk.

## Consequences

- The wasm is the single largest asset: `duckdb-eh.wasm` is 35.9 MB raw and **about 8.1 MB gzipped**
  (Pages serves it gzipped). The browser caches it after the first visit.
- Measured locally on `make preview` (M2), the cold **data-ready time is about 1.5–1.7 s**, from load
  until the first query returns. Pages show skeletons until then.
- SQL gives each page one flexible query layer. Types still come from `shared/schemas`, because the
  hooks return generated row types.
- The same Parquet files feed the Python batch job, so the web app and the reports read identical
  numbers.
- If load time or size becomes a problem, the fallback is per-page JSON slices produced by the
  pipeline, with the hooks' interface unchanged.
