/**
 * The query engine seam. In the browser this is a single DuckDB-WASM instance (created lazily on
 * the first parquet query); tests inject a Node engine via `setQueryEngine`.
 */
export interface QueryEngine {
  /** Make `bytes` readable by SQL as `read_parquet('<name>')`. */
  registerFile(name: string, bytes: Uint8Array): Promise<void>
  query(sql: string): Promise<Record<string, unknown>[]>
}

let enginePromise: Promise<QueryEngine> | null = null

export function getQueryEngine(): Promise<QueryEngine> {
  enginePromise ??= import('./duckdb').then((m) => m.createBrowserEngine())
  enginePromise.catch(() => {
    enginePromise = null // allow retry after a failed instantiate
  })
  return enginePromise
}

/**
 * Start DuckDB-WASM downloading/instantiating now (called once at app start) so it overlaps the
 * manifest + page-chunk fetches. Failures are swallowed here; the first query retries and surfaces them.
 */
export function prewarmQueryEngine(): void {
  getQueryEngine().catch(() => {})
}

/** Test/SSR hook: replace the engine (pass null to reset to the lazy browser engine). */
export function setQueryEngine(engine: QueryEngine | null): void {
  enginePromise = engine ? Promise.resolve(engine) : null
}

/** Arrow → plain JSON-ish rows: BigInt → number, typed arrays/vectors left alone. */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? Number(v) : v
  return out
}
