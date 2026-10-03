// Provider interface (BUILD_PLAN §5.4), mirroring ai/src/audible_ai/providers/base.py.

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateResult {
  rawText: string
  parsed: Record<string, unknown> | null
  latencyMs: number
  firstTokenMs: number | null
  promptTokens: number | null
  outputTokens: number | null
}

export interface GenerateJsonRequest {
  system: string
  user: string
  schema: object
  signal?: AbortSignal
  /** Called with each streamed text chunk. */
  onToken?: (token: string) => void
  temperature?: number
}

export interface StreamTextRequest {
  system: string
  messages: Message[]
  signal?: AbortSignal
  temperature?: number
}

export interface Provider {
  name: 'ollama' | 'cloud' | 'claude-dev'
  model: string
  generateJson(req: GenerateJsonRequest): Promise<GenerateResult>
  streamText(req: StreamTextRequest): AsyncIterable<string>
  health(): Promise<{ ok: boolean; models?: string[] }>
}

/** The provider failed to produce a response (HTTP or transport error). */
export class ProviderError extends Error {
  /** HTTP status when the failure was an HTTP error response. */
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.includes('\n') ? t.slice(t.indexOf('\n') + 1) : ''
    const end = t.lastIndexOf('```')
    if (end >= 0) t = t.slice(0, end)
  }
  try {
    const value: unknown = JSON.parse(t)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Yields each line of a streamed response body (NDJSON / SSE). */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        yield buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
      }
    }
    buffer += decoder.decode()
    if (buffer) yield buffer
  } finally {
    reader.releaseLock()
  }
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
