// Dev-only Claude adapter. It calls the Vite dev server's `/__claude` proxy (spec: docs/HANDOFFS.md),
// which adds the API key server-side. Only ever loaded through the dynamic import in ./index.ts
// under `import.meta.env.DEV`, so production builds contain none of this file.
import {
  type GenerateJsonRequest,
  type GenerateResult,
  type Provider,
  ProviderError,
  type StreamTextRequest,
  now,
  parseJsonObject,
  readLines,
} from './types'

/** Unique string that must never appear in a production bundle (checked by tests/ai/dist-secrets.test.ts). */
export const CLAUDE_DEV_ADAPTER_MARKER = 'audible-claude-dev-adapter-7f3a'
export const DEFAULT_CLAUDE_DEV_MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 8192
// Structured outputs reject these keywords; validate.ts enforces them locally instead.
const UNSUPPORTED = new Set(['minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'uniqueItems'])

export function claudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(claudeSchema)
  if (schema === null || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.has(k)) continue
    out[k] =
      k === 'properties'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, claudeSchema(sub)]))
        : claudeSchema(v)
  }
  return out
}

interface SseEvent {
  type: string
  delta?: { type?: string; text?: string; stop_reason?: string }
  message?: { usage?: { input_tokens?: number } }
  usage?: { output_tokens?: number }
  error?: { message?: string }
}

export function createClaudeDevProvider(
  model: string = DEFAULT_CLAUDE_DEV_MODEL,
  doFetch: typeof fetch = fetch,
): Provider & { adapterMarker: string } {
  async function* events(body: object, signal?: AbortSignal): AsyncGenerator<SseEvent> {
    const res = await doFetch('/__claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, stream: true, ...body }),
      signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new ProviderError(`claude-dev HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data:')) continue
      const event = JSON.parse(line.slice(5).trim()) as SseEvent
      if (event.type === 'error') throw new ProviderError(`claude-dev: ${event.error?.message ?? 'stream error'}`)
      yield event
    }
  }

  return {
    name: 'claude-dev',
    model,
    adapterMarker: CLAUDE_DEV_ADAPTER_MARKER,

    async generateJson(req: GenerateJsonRequest): Promise<GenerateResult> {
      const start = now()
      let first: number | null = null
      let text = ''
      let promptTokens: number | null = null
      let outputTokens: number | null = null
      let refused = false
      const body = {
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: { type: 'json_schema', schema: claudeSchema(req.schema) } },
      }
      for await (const ev of events(body, req.signal)) {
        if (ev.type === 'message_start') promptTokens = ev.message?.usage?.input_tokens ?? null
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          if (first === null) first = Math.round(now() - start)
          text += ev.delta.text
          req.onToken?.(ev.delta.text)
        }
        if (ev.type === 'message_delta') {
          outputTokens = ev.usage?.output_tokens ?? outputTokens
          refused = ev.delta?.stop_reason === 'refusal'
        }
      }
      return {
        rawText: text,
        parsed: refused ? null : parseJsonObject(text),
        latencyMs: Math.round(now() - start),
        firstTokenMs: first,
        promptTokens,
        outputTokens,
      }
    },

    async *streamText(req: StreamTextRequest): AsyncIterable<string> {
      for await (const ev of events({ system: req.system, messages: req.messages }, req.signal)) {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) yield ev.delta.text
      }
    },

    async health() {
      return { ok: true, models: [model] }
    },
  }
}
