// audible-ai: an Ollama-compatible subset (CONTRACT_CHANGES item 19) on top of Workers AI, so the
// web app's Ollama adapter works unchanged against this Worker's URL.
import {
  chooseModel,
  classifyUpstreamError,
  extractResult,
  ollamaChunk,
  ollamaDone,
  parseChatRequest,
  parseModels,
  RequestError,
  sseToNdjson,
  toWorkersAiInput,
  type ChatLimits,
} from './translate'

export interface Env {
  AI: Ai
  RATE_LIMITER?: RateLimit
  /** Default model alias (must appear in ALLOWED_MODELS). */
  MODEL: string
  /** "alias=@cf/model-id,..." */
  ALLOWED_MODELS: string
  /** Comma-separated exact origins. */
  ALLOWED_ORIGINS: string
}

export const MAX_BODY_BYTES = 64 * 1024
export const LIMITS: ChatLimits = { maxMessages: 16, maxOutputTokens: 1500 }
const RETRY_AFTER_S = 60

function allowedOrigins(env: Env): Set<string> {
  return new Set(env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean))
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function errorResponse(e: RequestError, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
  return json({ error: e.code, message: e.message }, e.status, { ...cors, ...extra })
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw new RequestError(413, 'too_large', `body must be at most ${MAX_BODY_BYTES} bytes`)
  const buf = await request.arrayBuffer()
  if (buf.byteLength > MAX_BODY_BYTES) throw new RequestError(413, 'too_large', `body must be at most ${MAX_BODY_BYTES} bytes`)
  try {
    return JSON.parse(new TextDecoder().decode(buf))
  } catch {
    throw new RequestError(400, 'bad_request', 'body is not valid JSON')
  }
}

async function chat(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  if (env.RATE_LIMITER) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success } = await env.RATE_LIMITER.limit({ key })
    if (!success) {
      return errorResponse(new RequestError(429, 'rate_limited', 'Too many requests; try again in a minute.'), cors, {
        'Retry-After': String(RETRY_AFTER_S),
      })
    }
  }
  const req = parseChatRequest(await readBody(request), LIMITS)
  const { models, fallback } = parseModels(env.ALLOWED_MODELS, env.MODEL)
  const model = chooseModel(req.model, models, fallback)
  const input = toWorkersAiInput(req, model, LIMITS)

  let result: unknown
  try {
    result = await env.AI.run(model.id as keyof AiModels, input as never)
  } catch (e) {
    throw classifyUpstreamError(e)
  }

  if (input.stream) {
    if (!(result instanceof ReadableStream)) throw classifyUpstreamError(new Error('expected a streamed response'))
    return new Response(sseToNdjson(result as ReadableStream<Uint8Array>, model.alias), {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', ...cors },
    })
  }
  const { content, promptTokens, outputTokens } = extractResult(result)
  if (req.stream) {
    // Structured (JSON-mode) requests can't stream upstream; send the whole answer as NDJSON.
    const body = ollamaChunk(model.alias, content) + ollamaDone(model.alias, promptTokens, outputTokens)
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', ...cors } })
  }
  return json(
    {
      model: model.alias,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: promptTokens,
      eval_count: outputTokens,
    },
    200,
    { 'Cache-Control': 'no-store', ...cors },
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    // Requests without an Origin (curl, server-side eval) get no CORS headers; the rate limit still applies.
    if (origin !== null && !allowedOrigins(env).has(origin)) {
      return json({ error: 'origin_not_allowed', message: `Origin ${origin} is not allowed` }, 403, { Vary: 'Origin' })
    }
    const cors = corsHeaders(origin)
    const { pathname } = new URL(request.url)

    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      if (pathname === '/api/tags' && request.method === 'GET') {
        const { models, fallback } = parseModels(env.ALLOWED_MODELS, env.MODEL)
        // The default model is listed first; the browser uses models[0].
        const ordered = [fallback, ...models.filter((m) => m.alias !== fallback.alias)]
        return json({ models: ordered.map((m) => ({ name: m.alias, model: m.alias })) }, 200, { 'Cache-Control': 'no-store', ...cors })
      }
      if (pathname === '/api/chat' && request.method === 'POST') return await chat(request, env, cors)
      if (pathname === '/api/tags' || pathname === '/api/chat') {
        return errorResponse(new RequestError(400, 'bad_request', `${request.method} is not supported on ${pathname}`), cors)
      }
      return json({ error: 'not_found', message: `No route for ${pathname}` }, 404, cors)
    } catch (e) {
      if (e instanceof RequestError) return errorResponse(e, cors)
      return errorResponse(new RequestError(502, 'upstream_error', e instanceof Error ? e.message : String(e)), cors)
    }
  },
} satisfies ExportedHandler<Env>
