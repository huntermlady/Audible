import type { Manifest } from '@/types/generated'
import { fetchJson } from './http'
import { dataUrl } from './urls'

let manifestPromise: Promise<Manifest> | null = null

/** manifest.json, fetched once per page load (retried if it failed). */
export function fetchManifest(): Promise<Manifest> {
  manifestPromise ??= fetchJson<Manifest>(dataUrl('manifest.json'))
  manifestPromise.catch(() => {
    manifestPromise = null
  })
  return manifestPromise
}

/** Test hook. */
export function resetManifestCache(): void {
  manifestPromise = null
}
