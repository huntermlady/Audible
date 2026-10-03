// Live-mode detection (BUILD_PLAN §4.2, CONTRACT_CHANGES 20). Mode `auto` probes local Ollama
// (1.5 s), then the Audible cloud Worker at VITE_AI_CLOUD_URL (3 s), then falls back to sample mode.
// Settings persist in localStorage under `audible.ai.settings`.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createOllamaProvider, DEFAULT_OLLAMA_URL, isDevClaudeModel, loadDevClaudeProvider } from './providers'
import { ProviderError, type Provider } from './providers/types'

export type AIStatus = 'checking' | 'live' | 'sample' | 'error'
export type AIMode = 'auto' | 'local' | 'cloud' | 'off'
export type AISource = 'local' | 'cloud' | null

export interface AISettings {
  mode: AIMode
  /** Local Ollama base URL (the cloud URL is a build-time value, VITE_AI_CLOUD_URL). */
  baseUrl: string
  /** Local Ollama model (the cloud Worker picks its own model). */
  model: string
}

export interface AIStatusValue {
  status: AIStatus
  source: AISource
  provider: Provider | null
  settings: AISettings
  setSettings(s: AISettings): void
  retry(): void
  errorHint?: string
  /** Whether this build has a cloud Worker URL configured. */
  cloudAvailable: boolean
}

export const SETTINGS_KEY = 'audible.ai.settings'
/** Keep in sync with config.toml [ai.live].model. */
export const DEFAULT_SETTINGS: AISettings = { mode: 'auto', baseUrl: DEFAULT_OLLAMA_URL, model: 'qwen3:4b-instruct' }
export const PROBE_TIMEOUT_MS = 1500
export const CLOUD_PROBE_TIMEOUT_MS = 3000
export const CLOUD_URL: string = (import.meta.env.VITE_AI_CLOUD_URL ?? '').replace(/\/+$/, '')

const MODES: readonly AIMode[] = ['auto', 'local', 'cloud', 'off']

export const BLOCKED_HINT =
  'If Ollama is running on this machine, the browser may be blocking this HTTPS page from reaching it over http://localhost. Use `make preview` for live mode.'
export const QUOTA_HINT = "Today's free live-AI allowance is used up — showing sample calls."
export const RATE_LIMIT_HINT = 'Too many live-AI requests right now — showing sample calls. Try again in a minute.'

function loadSettings(): AISettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AISettings>
    return normalizeSettings(parsed)
  } catch {
    return DEFAULT_SETTINGS
  }
}

function normalizeSettings(s: Partial<AISettings>): AISettings {
  return {
    mode: MODES.includes(s.mode as AIMode) ? (s.mode as AIMode) : DEFAULT_SETTINGS.mode,
    baseUrl: typeof s.baseUrl === 'string' && s.baseUrl.trim() ? s.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl,
    model: typeof s.model === 'string' && s.model.trim() ? s.model.trim() : DEFAULT_SETTINGS.model,
  }
}

function saveSettings(s: AISettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Storage unavailable (private mode, blocked): settings stay in memory for this session.
  }
}

export interface ProbeResult {
  status: Exclude<AIStatus, 'checking'>
  source: AISource
  provider: Provider | null
  errorHint?: string
}

const SAMPLE: ProbeResult = { status: 'sample', source: null, provider: null }
const pageIsHttps = () => typeof location !== 'undefined' && location.protocol === 'https:'

/** Probe local Ollama. Exported for tests. */
export async function probeLocal(settings: AISettings, doFetch: typeof fetch = fetch): Promise<ProbeResult> {
  if (isDevClaudeModel(settings.model)) {
    const provider = await loadDevClaudeProvider(settings.model)
    return provider ? { status: 'live', source: 'local', provider } : SAMPLE
  }
  const baseUrl = settings.baseUrl.replace(/\/+$/, '')
  let res: Response
  try {
    res = await doFetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  } catch (e) {
    // TypeError = network failure (not running, CORS, or mixed-content / local-network block).
    const blocked = e instanceof TypeError && pageIsHttps() && baseUrl.startsWith('http:')
    return { ...SAMPLE, errorHint: blocked ? BLOCKED_HINT : undefined }
  }
  if (!res.ok) return { status: 'error', source: null, provider: null, errorHint: `Ollama responded with HTTP ${res.status}.` }
  let models: string[]
  try {
    const data = (await res.json()) as { models?: { name: string }[] }
    models = (data.models ?? []).map((m) => m.name)
  } catch {
    return { status: 'error', source: null, provider: null, errorHint: 'Ollama returned an unexpected response.' }
  }
  const installed = new Set([...models, ...models.map((m) => m.replace(/:latest$/, ''))])
  if (!installed.has(settings.model)) {
    return {
      status: 'error',
      source: null,
      provider: null,
      errorHint: `Model ${settings.model} is not installed. Run \`ollama pull ${settings.model}\` or pick another model.`,
    }
  }
  return { status: 'live', source: 'local', provider: createOllamaProvider({ baseUrl, model: settings.model, fetch: doFetch }) }
}

function hintForStatus(status: number): string | undefined {
  if (status === 503) return QUOTA_HINT
  if (status === 429) return RATE_LIMIT_HINT
  return undefined
}

/** Probe the cloud Worker (Ollama-compatible `/api/tags`). Exported for tests. */
export async function probeCloud(cloudUrl: string, doFetch: typeof fetch = fetch): Promise<ProbeResult> {
  if (!cloudUrl) return SAMPLE
  let res: Response
  try {
    res = await doFetch(`${cloudUrl}/api/tags`, { signal: AbortSignal.timeout(CLOUD_PROBE_TIMEOUT_MS) })
  } catch {
    return SAMPLE
  }
  if (!res.ok) return { ...SAMPLE, errorHint: hintForStatus(res.status) }
  let model: string | undefined
  try {
    const data = (await res.json()) as { models?: { name: string }[] }
    model = data.models?.[0]?.name
  } catch {
    // fall through
  }
  if (!model) return SAMPLE
  return { status: 'live', source: 'cloud', provider: createOllamaProvider({ baseUrl: cloudUrl, model, name: 'cloud', fetch: doFetch }) }
}

/** Resolve the AI status for the settings' mode. Exported for tests. */
export async function probe(settings: AISettings, doFetch: typeof fetch = fetch, cloudUrl: string = CLOUD_URL): Promise<ProbeResult> {
  switch (settings.mode) {
    case 'off':
      return SAMPLE
    case 'local':
      return probeLocal(settings, doFetch)
    case 'cloud':
      return probeCloud(cloudUrl, doFetch)
    default: {
      const local = await probeLocal(settings, doFetch)
      if (local.status === 'live') return local
      const cloud = await probeCloud(cloudUrl, doFetch)
      if (cloud.status === 'live') return cloud
      return { ...SAMPLE, errorHint: cloud.errorHint ?? local.errorHint }
    }
  }
}

/**
 * Wraps a cloud provider so a 429/503 during use flips the app to sample mode with a hint
 * (CONTRACT_CHANGES 20). The error is still thrown to the caller.
 */
export function guardCloudProvider(provider: Provider, onLimit: (hint: string) => void): Provider {
  const check = (e: unknown) => {
    if (e instanceof ProviderError && e.status !== undefined) {
      const hint = hintForStatus(e.status)
      if (hint) onLimit(hint)
    }
    return e
  }
  return {
    ...provider,
    generateJson: (req) => provider.generateJson(req).catch((e: unknown) => Promise.reject(check(e))),
    async *streamText(req) {
      try {
        yield* provider.streamText(req)
      } catch (e) {
        throw check(e)
      }
    },
  }
}

const Ctx = createContext<AIStatusValue | null>(null)

export function AIStatusProvider({
  children,
  fetchImpl,
  cloudUrl = CLOUD_URL,
}: {
  children: ReactNode
  fetchImpl?: typeof fetch
  cloudUrl?: string
}) {
  const [settings, setSettingsState] = useState<AISettings>(loadSettings)
  const [nonce, setNonce] = useState(0)
  // The result is tagged with the probe it answers; a stale tag reads as 'checking'.
  const [done, setDone] = useState<{ key: string; result: ProbeResult } | null>(null)
  const key = `${nonce}|${settings.mode}|${settings.baseUrl}|${settings.model}|${cloudUrl}`
  const latest = useRef(key)

  useEffect(() => {
    latest.current = key
    const settle = (result: ProbeResult) => {
      if (latest.current === key) setDone({ key, result })
    }
    const onLimit = (hint: string) => settle({ ...SAMPLE, errorHint: hint })
    probe(settings, fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a)), cloudUrl).then(
      (r) => settle(r.source === 'cloud' && r.provider ? { ...r, provider: guardCloudProvider(r.provider, onLimit) } : r),
      () => settle({ status: 'error', source: null, provider: null }),
    )
  }, [key, settings, fetchImpl, cloudUrl])

  const result = done?.key === key ? done.result : null

  const setSettings = useCallback((s: AISettings) => {
    const next = normalizeSettings(s)
    saveSettings(next)
    setSettingsState(next)
  }, [])
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  const value = useMemo<AIStatusValue>(
    () => ({
      status: result?.status ?? 'checking',
      source: result?.source ?? null,
      provider: result?.provider ?? null,
      settings,
      setSettings,
      retry,
      errorHint: result?.errorHint,
      cloudAvailable: cloudUrl !== '',
    }),
    [result, settings, setSettings, retry, cloudUrl],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAIStatus(): AIStatusValue {
  const value = useContext(Ctx)
  if (!value) throw new Error('useAIStatus must be used inside <AIStatusProvider>')
  return value
}
