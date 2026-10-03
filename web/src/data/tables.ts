import { getQueryEngine } from './engine'
import { fetchBuffer } from './http'
import { fetchManifest } from './manifest'
import type { BuiltQuery, ParquetTable } from './sql'
import { dataUrl } from './urls'

const registered = new Map<ParquetTable, Promise<void>>()

/**
 * Lazily fetch one parquet file (path from the manifest) and expose it as a view named after
 * the table. Each file is fetched at most once per page load, and only when a query needs it.
 */
export function ensureTable(table: ParquetTable): Promise<void> {
  let p = registered.get(table)
  if (!p) {
    p = (async () => {
      const enginePromise = getQueryEngine() // in flight while the manifest resolves
      const manifest = await fetchManifest()
      const entry = manifest.files[table] as { path: string } | undefined
      if (!entry) throw new Error(`manifest.json has no entry for ${table}`)
      const [engine, bytes] = await Promise.all([enginePromise, fetchBuffer(dataUrl(entry.path))])
      await engine.registerFile(entry.path, bytes)
      await engine.query(`CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_parquet('${entry.path.replace(/'/g, "''")}')`)
    })()
    registered.set(table, p)
    p.catch(() => registered.delete(table))
  }
  return p
}

export async function runQuery<T>(q: BuiltQuery): Promise<T[]> {
  await ensureTable(q.table)
  const engine = await getQueryEngine()
  return (await engine.query(q.sql)) as T[]
}

/** Test hook. */
export function resetTables(): void {
  registered.clear()
}
