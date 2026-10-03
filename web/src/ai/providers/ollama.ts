// Ollama adapter: POST /api/chat with `format` = JSON Schema, streamed NDJSON.
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

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

interface OllamaChunk {
  message?: { content?: string }
  done?: boolean
  error?: string
  prompt_eval_count?: number
  eval_count?: number
}

export interface OllamaOptions {
  baseUrl?: string
  model: string
  /** 'cloud' when the base URL is the Audible Worker (same Ollama-compatible API). */
  name?: 'ollama' | 'cloud'
  /** Send `think: false` so hybrid-thinking models answer directly (default false). */
  think?: boolean
  fetch?: typeof fetch
}

export function createOllamaProvider(opts: OllamaOptions): Provider {
  const baseUrl = (opts.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '')
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const think = opts.think ?? false

  async function* chat(body: object, signal?: AbortSignal): AsyncGenerator<OllamaChunk> {
    const res = await doFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new ProviderError(`${opts.name ?? 'ollama'} HTTP ${res.status}: ${text.slice(0, 300)}`, res.status)
    }
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as OllamaChunk
      if (chunk.error) throw new ProviderError(`ollama: ${chunk.error}`)
      yield chunk
    }
  }

  return {
    name: opts.name ?? 'ollama',
    model: opts.model,

    async generateJson(req: GenerateJsonRequest): Promise<GenerateResult> {
      const start = now()
      let first: number | null = null
      let text = ''
      let final: OllamaChunk = {}
      const body = {
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        format: req.schema,
        stream: true,
        think,
        options: { temperature: req.temperature ?? 0.2 },
      }
      for await (const chunk of chat(body, req.signal)) {
        const content = chunk.message?.content ?? ''
        if (content) {
          if (first === null) first = Math.round(now() - start)
          text += content
          req.onToken?.(content)
        }
        if (chunk.done) final = chunk
      }
      return {
        rawText: text,
        parsed: parseJsonObject(text),
        latencyMs: Math.round(now() - start),
        firstTokenMs: first,
        promptTokens: final.prompt_eval_count ?? null,
        outputTokens: final.eval_count ?? null,
      }
    },

    async *streamText(req: StreamTextRequest): AsyncIterable<string> {
      const body = {
        model: opts.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        stream: true,
        think,
        options: { temperature: req.temperature ?? 0.4 },
      }
      for await (const chunk of chat(body, req.signal)) {
        const content = chunk.message?.content ?? ''
        if (content) yield content
      }
    },

    async health() {
      try {
        const res = await doFetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) })
        if (!res.ok) return { ok: false }
        const data = (await res.json()) as { models?: { name: string }[] }
        return { ok: true, models: (data.models ?? []).map((m) => m.name) }
      } catch {
        return { ok: false }
      }
    },
  }
}
