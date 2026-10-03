import { describe, expect, it, vi } from 'vitest'
import worker, { type Env, MAX_BODY_BYTES } from '../src/index'
import { parseSseData, sseToNdjson, ThinkFilter } from '../src/translate'

const ORIGIN = 'http://localhost:5173'
const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8'

type RunFn = (model: string, input: Record<string, unknown>) => Promise<unknown>

function makeEnv(run: RunFn, limitOk = true) {
  const limit = vi.fn(async () => ({ success: limitOk }))
  const env: Env = {
    AI: { run: vi.fn(run) } as unknown as Ai,
    RATE_LIMITER: { limit } as unknown as RateLimit,
    MODEL: 'qwen3-30b-a3b',
    ALLOWED_MODELS: `qwen3-30b-a3b=${QWEN},llama-3.1-8b=@cf/meta/llama-3.1-8b-instruct-fp8`,
    ALLOWED_ORIGINS: 'https://huntermlady.github.io,http://localhost:5173,http://localhost:4173',
  }
  return { env, run: env.AI.run as unknown as ReturnType<typeof vi.fn>, limit }
}

function chatRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://audible-ai.example.workers.dev/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const MESSAGES = [
  { role: 'system', content: 'You are an OC.' },
  { role: 'user', content: 'Call a play.' },
]

const completion = (content: string, usage = { prompt_tokens: 120, completion_tokens: 30 }) => ({
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content } }],
  usage,
})

function sse(events: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(e))
      c.close()
    },
  })
}

async function ndjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('GET /api/tags', () => {
  it('lists the default model first, with CORS for an allowed origin', async () => {
    const { env } = makeEnv(async () => ({}))
    const res = await worker.fetch(new Request('https://w.dev/api/tags', { headers: { Origin: ORIGIN } }), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      models: [
        { name: 'qwen3-30b-a3b', model: 'qwen3-30b-a3b' },
        { name: 'llama-3.1-8b', model: 'llama-3.1-8b' },
      ],
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(res.headers.get('Vary')).toBe('Origin')
  })
})

describe('CORS', () => {
  it('answers preflight for allowed origins', async () => {
    const { env } = makeEnv(async () => ({}))
    const res = await worker.fetch(
      new Request('https://w.dev/api/chat', { method: 'OPTIONS', headers: { Origin: 'https://huntermlady.github.io' } }),
      env,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://huntermlady.github.io')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
  })

  it('rejects other origins with 403 origin_not_allowed and never calls the model', async () => {
    const { env, run } = makeEnv(async () => completion('{}'))
    const res = await worker.fetch(chatRequest({ messages: MESSAGES }, { Origin: 'https://evil.example' }), env)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'origin_not_allowed' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('serves requests without an Origin (curl, server-side eval) without CORS headers', async () => {
    const { env } = makeEnv(async () => ({}))
    const res = await worker.fetch(new Request('https://w.dev/api/tags'), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('POST /api/chat, non-streamed', () => {
  it('maps format → response_format json_schema and returns the Ollama shape', async () => {
    const schema = { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] }
    const { env, run } = makeEnv(async () => completion('{"a": 1}'))
    const res = await worker.fetch(
      chatRequest({ model: 'not-allowed', messages: MESSAGES, stream: false, format: schema, options: { temperature: 0.2 }, think: false }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'qwen3-30b-a3b',
      message: { role: 'assistant', content: '{"a": 1}' },
      done: true,
      prompt_eval_count: 120,
      eval_count: 30,
    })
    const [model, input] = run.mock.calls[0] as [string, Record<string, unknown>]
    expect(model).toBe(QWEN) // unknown model → default
    expect(input).toMatchObject({
      stream: false,
      max_tokens: 1500,
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: schema },
    })
    const msgs = input.messages as { role: string; content: string }[]
    expect(msgs.at(-1)?.content).toBe('Call a play.\n/no_think')
    expect(msgs[0].content).toBe('You are an OC.')
  })

  it('honors an allowlisted model, keeps thinking when asked, strips a think block, handles legacy output', async () => {
    const { env, run } = makeEnv(async () => ({ response: { a: 2 }, usage: { prompt_tokens: 5 } }))
    const res = await worker.fetch(chatRequest({ model: 'llama-3.1-8b', messages: MESSAGES, stream: false, format: 'json' }), env)
    expect(await res.json()).toMatchObject({ model: 'llama-3.1-8b', message: { content: '{"a":2}' }, prompt_eval_count: 5, eval_count: null })
    const [model, input] = run.mock.calls[0] as [string, Record<string, unknown>]
    expect(model).toBe('@cf/meta/llama-3.1-8b-instruct-fp8')
    expect(input.response_format).toEqual({ type: 'json_object' })
    expect((input.messages as { content: string }[]).at(-1)?.content).toBe('Call a play.') // not a qwen3 model

    const think = makeEnv(async () => completion('<think>\nhmm\n</think>\n\nFirst down.'))
    const r2 = await worker.fetch(chatRequest({ messages: MESSAGES, stream: false, think: true }), think.env)
    expect(await r2.json()).toMatchObject({ message: { content: 'First down.' } })
    const input2 = think.run.mock.calls[0][1] as { messages: { content: string }[] }
    expect(input2.messages.at(-1)?.content).toBe('Call a play.')
  })
})

describe('POST /api/chat, streamed', () => {
  it('translates Workers AI SSE to Ollama NDJSON (OpenAI delta shape)', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"<th"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ink>\\n\\n</think>\\n\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"secret"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Run "}}]}\n\ndata: {"choices":[{"delta":{"content":"it."}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ]
    const { env, run } = makeEnv(async () => sse(events))
    const res = await worker.fetch(chatRequest({ messages: MESSAGES, stream: true }), env)
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const lines = await ndjson(res)
    expect(lines.filter((l) => !l.done).map((l) => (l.message as { content: string }).content).join('')).toBe('Run it.')
    expect(lines.at(-1)).toMatchObject({ done: true, model: 'qwen3-30b-a3b', prompt_eval_count: 50, eval_count: 4 })
    expect(lines.filter((l) => l.done)).toHaveLength(1)
    expect((run.mock.calls[0][1] as { stream: boolean }).stream).toBe(true)
  })

  it('handles the legacy {response} SSE shape and a stream without [DONE]', async () => {
    const { env } = makeEnv(async () => sse(['data: {"response":"Hi"}\n\n', 'data: {"response":" there"}']))
    const lines = await ndjson(await worker.fetch(chatRequest({ messages: MESSAGES }), env))
    expect(lines.map((l) => (l.message as { content: string } | undefined)?.content ?? '').join('')).toBe('Hi there')
    expect(lines.at(-1)).toMatchObject({ done: true, prompt_eval_count: null })
  })

  it('structured requests run non-streamed upstream and are replayed as NDJSON', async () => {
    const { env, run } = makeEnv(async () => completion('{"ok":true}'))
    const res = await worker.fetch(chatRequest({ messages: MESSAGES, stream: true, format: { type: 'object' } }), env)
    const lines = await ndjson(res)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ done: false, message: { content: '{"ok":true}' } })
    expect(lines[1]).toMatchObject({ done: true, eval_count: 30 })
    expect((run.mock.calls[0][1] as { stream: boolean }).stream).toBe(false)
  })
})

describe('limits and errors', () => {
  it('400 bad_request for malformed bodies', async () => {
    const { env, run } = makeEnv(async () => completion(''))
    for (const body of ['not json', { messages: [] }, { messages: [{ role: 'tool', content: 'x' }] }, { messages: MESSAGES, format: 3 }]) {
      const res = await worker.fetch(chatRequest(body), env)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_request' })
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('413 too_large for oversized bodies and too many messages', async () => {
    const { env, run } = makeEnv(async () => completion(''))
    const big = await worker.fetch(chatRequest({ messages: [{ role: 'user', content: 'x'.repeat(MAX_BODY_BYTES) }] }), env)
    expect(big.status).toBe(413)
    expect(await big.json()).toMatchObject({ error: 'too_large' })
    const many = Array.from({ length: 17 }, () => ({ role: 'user', content: 'hi' }))
    const res = await worker.fetch(chatRequest({ messages: many }), env)
    expect(res.status).toBe(413)
    expect(run).not.toHaveBeenCalled()
  })

  it('429 rate_limited with Retry-After, keyed by client IP', async () => {
    const { env, run, limit } = makeEnv(async () => completion(''), false)
    const res = await worker.fetch(chatRequest({ messages: MESSAGES }), env)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(await res.json()).toMatchObject({ error: 'rate_limited' })
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
    expect(run).not.toHaveBeenCalled()
  })

  it('503 quota_exhausted when the daily free allocation is used up', async () => {
    const { env } = makeEnv(async () => {
      throw new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons')
    })
    const res = await worker.fetch(chatRequest({ messages: MESSAGES }), env)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'quota_exhausted' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('502 upstream_error for other Workers AI failures, including JSON mode failures', async () => {
    for (const msg of ['3040: Capacity temporarily exceeded', "JSON Mode couldn't be met"]) {
      const { env } = makeEnv(async () => {
        throw new Error(msg)
      })
      const res = await worker.fetch(chatRequest({ messages: MESSAGES, stream: false }), env)
      expect(res.status).toBe(502)
      expect(await res.json()).toMatchObject({ error: 'upstream_error' })
    }
  })

  it('404 for unknown routes and 400 for wrong methods', async () => {
    const { env } = makeEnv(async () => ({}))
    expect((await worker.fetch(new Request('https://w.dev/api/generate', { method: 'POST' }), env)).status).toBe(404)
    expect((await worker.fetch(new Request('https://w.dev/api/chat'), env)).status).toBe(400)
  })
})

describe('translation helpers', () => {
  it('ThinkFilter passes normal text through untouched, including a leading "<"', () => {
    const f = new ThinkFilter()
    expect(f.push('<')).toBe('')
    expect(f.push('b>bold')).toBe('<b>bold')
    expect(f.push(' more')).toBe(' more')
    const g = new ThinkFilter()
    expect(g.push('  <thi')).toBe('')
    expect(g.flush()).toBe('<thi')
    const h = new ThinkFilter()
    expect(h.push('\n\n')).toBe('')
    expect(h.push('Play-action is')).toBe('Play-action is')
    expect(h.push('\n more')).toBe('\n more')
  })

  it('parseSseData ignores reasoning deltas and bad JSON', () => {
    expect(parseSseData('{"choices":[{"delta":{"reasoning_content":"x"}}]}')).toMatchObject({ text: '' })
    expect(parseSseData('nope')).toMatchObject({ text: '', done: false })
    expect(parseSseData('[DONE]').done).toBe(true)
  })

  it('sseToNdjson emits exactly one done line even when upstream sends [DONE] early', async () => {
    const out = sseToNdjson(sse(['data: {"response":"a"}\n\ndata: [DONE]\n\n']), 'm')
    const text = await new Response(out).text()
    expect(text.split('\n').filter(Boolean).map((l) => JSON.parse(l).done)).toEqual([false, true])
  })
})
