import * as duckdb from '@duckdb/duckdb-wasm'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import { normalizeRow, type QueryEngine } from './engine'

// EH (wasm exceptions) only: every current browser supports it, and not shipping the MVP
// bundle keeps ~41 MB out of dist. Older browsers get the data error state.
const BUNDLE = { mainModule: ehWasm, mainWorker: ehWorker }

/** The app's single DuckDB-WASM instance. Loaded via dynamic import so it stays out of the entry chunk. */
export async function createBrowserEngine(): Promise<QueryEngine> {
  const worker = new Worker(BUNDLE.mainWorker)
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)
  await db.instantiate(BUNDLE.mainModule)
  const conn = await db.connect()
  return {
    async registerFile(name, bytes) {
      await db.registerFileBuffer(name, bytes)
    },
    async query(sql) {
      const table = await conn.query(sql)
      return table.toArray().map((r) => normalizeRow(r.toJSON() as Record<string, unknown>))
    },
  }
}
