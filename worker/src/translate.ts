// Ollama-compatible ⇄ Workers AI translation (CONTRACT_CHANGES item 19). Pure functions, no I/O.

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OllamaChatRequest {
  model?: string
  messages: OllamaMessage[]
  stream: boolean
  format?: Record<string, unknown> | 'json'
  options?: { temperature?: number }
  think?: boolean
}

export interface ChatLimits {
  maxMessages: number
  maxOutputTokens: number
}

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const ROLES = new Set(['system', 'user', 'assistant'])

/** Validate and normalize an Ollama /api/chat body. Throws RequestError(400) on bad input. */
export function parseChatRequest(body: unknown, limits: ChatLimits): OllamaChatRequest {
  const bad = (message: string) => new RequestError(400, 'bad_request', message)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be a JSON object')
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.messages) || b.messages.length === 0) throw bad('messages must be a non-empty array')
  if (b.messages.length > limits.maxMessages) {
    throw new RequestError(413, 'too_large', `at most ${limits.maxMessages} messages are allowed`)
  }
  const messages = b.messages.map((m, i) => {
    const msg = m as Record<string, unknown> | null
    if (!msg || typeof msg.content !== 'string' || typeof msg.role !== 'string' || !ROLES.has(msg.role)) {
      throw bad(`messages[${i}] must be {role: system|user|assistant, content: string}`)
    }
    return { role: msg.role as OllamaMessage['role'], content: msg.content }
  })
  if (b.stream !== undefined && typeof b.stream !== 'boolean') throw bad('stream must be a boolean')
  if (b.model !== undefined && typeof b.model !== 'string') throw bad('model must be a string')
  if (b.think !== undefined && typeof b.think !== 'boolean') throw bad('think must be a boolean')
  let format: OllamaChatRequest['format']
  if (b.format !== undefined && b.format !== null && b.format !== '') {
    if (b.format === 'json') format = 'json'
    else if (typeof b.format === 'object' && !Array.isArray(b.format)) format = b.format as Record<string, unknown>
    else throw bad("format must be a JSON Schema object or 'json'")
  }
  let options: OllamaChatRequest['options']
  if (b.options !== undefined) {
    if (!b.options || typeof b.options !== 'object') throw bad('options must be an object')
    const t = (b.options as Record<string, unknown>).temperature
    if (t !== undefined && (typeof t !== 'number' || t < 0 || t > 2)) throw bad('options.temperature must be a number in 0..2')
    options = { temperature: t as number | undefined }
  }
  return {
    model: b.model as string | undefined,
    messages,
    // Ollama streams unless told otherwise.
    stream: b.stream === undefined ? true : (b.stream as boolean),
    format,
    options,
    think: b.think as boolean | undefined,
  }
}

export interface ModelChoice {
  alias: string
  id: string
}

/** `ALLOWED_MODELS` = "alias=@cf/id,alias2=@cf/id2". The request's model is used only if listed. */
export function parseModels(allowed: string, defaultAlias: string): { models: ModelChoice[]; fallback: ModelChoice } {
  const models = allowed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [alias, id] = pair.split('=').map((s) => s.trim())
      return { alias, id: id || alias }
    })
  const fallback = models.find((m) => m.alias === defaultAlias) ?? models[0]
  if (!fallback) throw new Error('ALLOWED_MODELS is empty')
  return { models, fallback }
}

export function chooseModel(requested: string | undefined, models: ModelChoice[], fallback: ModelChoice): ModelChoice {
  if (!requested) return fallback
  return models.find((m) => m.alias === requested || m.id === requested) ?? fallback
}

/** Workers AI input for a chat request. Qwen3 hybrid models get the `/no_think` soft switch unless think=true. */
export function toWorkersAiInput(req: OllamaChatRequest, model: ModelChoice, limits: ChatLimits): Record<string, unknown> {
  const messages = req.messages.map((m) => ({ ...m }))
  if (req.think !== true && /qwen3/i.test(model.id)) {
    const lastUser = messages.map((m) => m.role).lastIndexOf('user')
    if (lastUser >= 0) messages[lastUser].content = `${messages[lastUser].content}\n/no_think`
  }
  const input: Record<string, unknown> = {
    messages,
    max_tokens: limits.maxOutputTokens,
    // JSON mode cannot stream on Workers AI, so structured requests always run non-streamed.
    stream: req.stream && req.format === undefined,
  }
  if (req.options?.temperature !== undefined) input.temperature = req.options.temperature
  if (req.format === 'json') input.response_format = { type: 'json_object' }
  else if (req.format) input.response_format = { type: 'json_schema', json_schema: req.format }
  return input
}

const THINK_BLOCK = /^\s*<think>[\s\S]*?<\/think>\s*/

/** Text of a non-streamed Workers AI result (OpenAI chat-completion or legacy `{response}` shape). */
export function extractResult(result: unknown): { content: string; promptTokens: number | null; outputTokens: number | null } {
  let content = ''
  let usage: Record<string, unknown> | undefined
  if (typeof result === 'string') {
    content = result
  } else if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    usage = r.usage as Record<string, unknown> | undefined
    const choice = Array.isArray(r.choices) ? (r.choices[0] as Record<string, unknown> | undefined) : undefined
    const message = choice?.message as Record<string, unknown> | undefined
    const raw = message?.content ?? choice?.text ?? r.response
    // Legacy JSON mode returns `response` as an already-parsed object.
    content = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)
  }
  return {
    content: content.replace(THINK_BLOCK, '').trimStart(),
    promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
  }
}

export function ollamaChunk(model: string, content: string): string {
  return JSON.stringify({ model, created_at: new Date().toISOString(), message: { role: 'assistant', content }, done: false }) + '\n'
}

export function ollamaDone(model: string, promptTokens: number | null, outputTokens: number | null, content?: string): string {
  const out: Record<string, unknown> = { model, created_at: new Date().toISOString() }
  if (content !== undefined) out.message = { role: 'assistant', content }
  Object.assign(out, { done: true, done_reason: 'stop', prompt_eval_count: promptTokens, eval_count: outputTokens })
  return JSON.stringify(out) + '\n'
}

/**
 * Drops a leading `<think>…</think>` block (and the whitespace after it) from a token stream. Qwen3
 * emits an empty one under /no_think. Everything else passes through unchanged.
 */
export class ThinkFilter {
  private buffer = ''
  private state: 'start' | 'thinking' | 'after' | 'pass' = 'start'

  push(text: string): string {
    if (this.state === 'pass') return text
    if (this.state === 'after') {
      const t = text.trimStart()
      if (t) this.state = 'pass'
      return t
    }
    this.buffer += text
    if (this.state === 'start') {
      const t = this.buffer.trimStart()
      if (t.length < '<think>'.length && '<think>'.startsWith(t)) return '' // may still become <think>
      if (!t.startsWith('<think>')) {
        // Leading whitespace at the very start of an answer is dropped too (Qwen3 emits "\n\n").
        this.state = 'pass'
        this.buffer = ''
        return t
      }
      this.state = 'thinking'
    }
    const end = this.buffer.indexOf('</think>')
    if (end < 0) return ''
    const rest = this.buffer.slice(end + '</think>'.length).trimStart()
    this.buffer = ''
    this.state = rest ? 'pass' : 'after'
    return rest
  }

  /** Text still held back at end of stream (only a partial, non-think prefix is released). */
  flush(): string {
    const out = this.state === 'start' ? this.buffer.trimStart() : ''
    this.buffer = ''
    return out
  }
}

/** Text delta and usage from one Workers AI SSE `data:` payload (OpenAI or legacy shape). */
export function parseSseData(data: string): { text: string; promptTokens?: number; outputTokens?: number; done: boolean } {
  if (data === '[DONE]') return { text: '', done: true }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(data) as Record<string, unknown>
  } catch {
    return { text: '', done: false }
  }
  const choice = Array.isArray(obj.choices) ? (obj.choices[0] as Record<string, unknown> | undefined) : undefined
  const delta = choice?.delta as Record<string, unknown> | undefined
  // reasoning_content deltas are deliberately ignored.
  const text = typeof delta?.content === 'string' ? delta.content : typeof obj.response === 'string' ? obj.response : ''
  const usage = obj.usage as Record<string, unknown> | undefined
  return {
    text,
    promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    done: false,
  }
}

/** Workers AI SSE byte stream → Ollama NDJSON byte stream. */
export function sseToNdjson(upstream: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const think = new ThinkFilter()
  let buffer = ''
  let promptTokens: number | null = null
  let outputTokens: number | null = null
  let finished = false

  const emitText = (controller: TransformStreamDefaultController<Uint8Array>, text: string) => {
    const out = think.push(text)
    if (out) controller.enqueue(enc.encode(ollamaChunk(model, out)))
  }
  const handleLine = (controller: TransformStreamDefaultController<Uint8Array>, line: string) => {
    if (!line.startsWith('data:')) return
    const parsed = parseSseData(line.slice(5).trim())
    if (parsed.promptTokens !== undefined) promptTokens = parsed.promptTokens
    if (parsed.outputTokens !== undefined) outputTokens = parsed.outputTokens
    if (parsed.done) {
      finish(controller)
      return
    }
    if (parsed.text) emitText(controller, parsed.text)
  }
  const finish = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (finished) return
    finished = true
    const rest = think.flush()
    if (rest) controller.enqueue(enc.encode(ollamaChunk(model, rest)))
    controller.enqueue(enc.encode(ollamaDone(model, promptTokens, outputTokens)))
  }

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += dec.decode(chunk, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          handleLine(controller, buffer.slice(0, nl).replace(/\r$/, ''))
          buffer = buffer.slice(nl + 1)
        }
      },
      flush(controller) {
        buffer += dec.decode()
        if (buffer) handleLine(controller, buffer)
        finish(controller)
      },
    }),
  )
}

/** Maps a Workers AI failure to the Worker's error contract. */
export function classifyUpstreamError(e: unknown): RequestError {
  const message = e instanceof Error ? e.message : String(e)
  if (/\b3036\b|daily free allocation|neurons/i.test(message)) {
    return new RequestError(503, 'quota_exhausted', "The Workers AI daily free allocation is used up; it resets at 00:00 UTC.")
  }
  if (/\b3006\b|too large/i.test(message)) return new RequestError(413, 'too_large', 'The request is too large for the model.')
  if (/JSON Mode couldn't be met/i.test(message)) {
    return new RequestError(502, 'upstream_error', 'The model could not satisfy the JSON schema (JSON Mode couldn\'t be met).')
  }
  return new RequestError(502, 'upstream_error', `Workers AI error: ${message.slice(0, 300)}`)
}
