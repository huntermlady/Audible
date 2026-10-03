import { createRequire } from 'node:module'
import * as duckdb from '@duckdb/duckdb-wasm/blocking'
import { normalizeRow, type QueryEngine } from '@/data/engine'

const require = createRequire(import.meta.url)

/** A real DuckDB (WASM, blocking Node build) behind the app's QueryEngine seam. */
export async function createNodeEngine(): Promise<QueryEngine> {
  const bundles: duckdb.DuckDBBundles = {
    mvp: { mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'), mainWorker: '' },
    eh: { mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'), mainWorker: '' },
  }
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME)
  await db.instantiate()
  const conn = db.connect()
  return {
    async registerFile(name, bytes) {
      db.registerFileBuffer(name, bytes)
    },
    async query(sql) {
      return conn.query(sql).toArray().map((r) => normalizeRow(r.toJSON() as Record<string, unknown>))
    },
  }
}
