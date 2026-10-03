export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`GET ${url} failed: ${status}`)
    this.name = 'HttpError'
  }
}

/**
 * True when a "successful" response is really an SPA fallback page (vite preview / static hosts
 * answer unknown paths with index.html). Treated as a 404 for data files.
 */
function isHtmlFallback(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('text/html')
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok || isHtmlFallback(res)) throw new HttpError(url, res.ok ? 404 : res.status)
  return (await res.json()) as T
}

/** Like fetchJson, but a missing file (404) resolves to `fallback`. */
export async function fetchJsonOr<T>(url: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    return await fetchJson<T>(url, init)
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return fallback
    throw e
  }
}

export async function fetchBuffer(url: string, init?: RequestInit): Promise<Uint8Array> {
  const res = await fetch(url, init)
  if (!res.ok || isHtmlFallback(res)) throw new HttpError(url, res.ok ? 404 : res.status)
  return new Uint8Array(await res.arrayBuffer())
}
