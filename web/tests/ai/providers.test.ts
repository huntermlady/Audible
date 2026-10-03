import { describe, expect, it, vi } from 'vitest'
import { createOllamaProvider } from '@/ai'
import { claudeSchema, createClaudeDevProvider } from '@/ai/providers/claude-dev'
import { BLOCKED_HINT, guardCloudProvider, probe, probeLocal, QUOTA_HINT, RATE_LIMIT_HINT } from '@/ai/status'
import { streamResponse } from './helpers'

describe('ollama provider', () => {
  it('streams /api/chat with format and parses the JSON', async () => {
    let body: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return streamResponse([
        '{"message":{"content":"{\\"a\\":"},"done":false}\n{"message":{"content":" 1',
        '}"},"done":false}\n{"message":{"content":""},"done":true,"prompt_eval_count":12,"eval_count":3}\n',
      ])
    })
    const p = createOllamaProvider({ baseUrl: 'http://ollama.test/', model: 'qwen3:4b', fetch: fetchMock as typeof fetch })
    const tokens: string[] = []
    const r = await p.generateJson({ system: 's', user: 'u', schema: { type: 'object' }, onToken: (t) => tokens.push(t) })
    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test/api/chat')
    expect(body).toMatchObject({ format: { type: 'object' }, stream: true, think: false, model: 'qwen3:4b' })
    expect(r.parsed).toEqual({ a: 1 })
    expect([r.promptTokens, r.outputTokens]).toEqual([12, 3])
    expect(tokens.join('')).toBe('{"a": 1}')
  })

  it('reports HTTP and in-stream errors', async () => {
    const http = createOllamaProvider({ model: 'm', fetch: (async () => new Response('boom', { status: 500 })) as typeof fetch })
    await expect(http.generateJson({ system: '', user: '', schema: {} })).rejects.toThrow('ollama HTTP 500')
    const inStream = createOllamaProvider({ model: 'm', fetch: (async () => streamResponse(['{"error":"no model"}\n'])) as typeof fetch })
    await expect(inStream.generateJson({ system: '', user: '', schema: {} })).rejects.toThrow('no model')
  })
})

describe('claude-dev provider', () => {
  it('posts to /__claude and parses the SSE stream', async () => {
    let body: Record<string, unknown> = {}
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":40}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"ok\\":"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" true}"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
    ]
    const fetchMock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return streamResponse(sse)
    })
    const p = createClaudeDevProvider('claude-sonnet-5', fetchMock as typeof fetch)
    const r = await p.generateJson({ system: 's', user: 'u', schema: { type: 'object', minProperties: 1, properties: {} } })
    expect(fetchMock.mock.calls[0][0]).toBe('/__claude')
    expect(body).toMatchObject({ model: 'claude-sonnet-5', stream: true, system: 's' })
    expect(r.parsed).toEqual({ ok: true })
    expect([r.promptTokens, r.outputTokens]).toEqual([40, 7])
  })

  it('strips unsupported schema keywords but keeps property names', () => {
    expect(claudeSchema({ type: 'object', properties: { minItems: { type: 'array', minItems: 1 } } })).toEqual({
      type: 'object',
      properties: { minItems: { type: 'array' } },
    })
  })
})

describe('status probe', () => {
  const settings = { mode: 'auto' as const, baseUrl: 'http://localhost:11434', model: 'qwen3:4b' }
  const CLOUD = 'https://audible-ai.example.workers.dev'
  const tags = (names: string[]) => Response.json({ models: names.map((name) => ({ name })) })
  /** fetch that answers per host: a Response, or 'down' to throw a network TypeError. */
  const router = (local: Response | 'down', cloud: Response | 'down') =>
    vi.fn(async (url: RequestInfo | URL) => {
      const r = String(url).startsWith(CLOUD) ? cloud : local
      if (r === 'down') throw new TypeError('Failed to fetch')
      return r.clone()
    }) as unknown as typeof fetch

  it('auto: local Ollama wins when the model is installed', async () => {
    const r = await probe(settings, router(tags(['qwen3:4b']), tags(['llama'])), CLOUD)
    expect(r).toMatchObject({ status: 'live', source: 'local' })
    expect(r.provider?.name).toBe('ollama')
  })

  it('auto: falls back to the cloud Worker, reusing the Ollama adapter', async () => {
    const f = router('down', tags(['llama-3.1-8b']))
    const r = await probe(settings, f, CLOUD)
    expect(r).toMatchObject({ status: 'live', source: 'cloud' })
    expect(r.provider).toMatchObject({ name: 'cloud', model: 'llama-3.1-8b' })
    expect(vi.mocked(f).mock.calls.map((c) => String(c[0]))).toEqual([
      'http://localhost:11434/api/tags',
      `${CLOUD}/api/tags`,
    ])
  })

  it('auto: sample mode with the quota hint when the Worker answers 503', async () => {
    const r = await probe(settings, router('down', new Response('{}', { status: 503 })), CLOUD)
    expect(r).toMatchObject({ status: 'sample', source: null, provider: null, errorHint: QUOTA_HINT })
  })

  it('auto: sample mode when neither is reachable or no cloud URL is configured', async () => {
    expect(await probe(settings, router('down', 'down'), CLOUD)).toMatchObject({ status: 'sample', source: null })
    const f = router('down', tags(['x']))
    expect(await probe(settings, f, '')).toMatchObject({ status: 'sample' })
    expect(vi.mocked(f)).toHaveBeenCalledTimes(1)
  })

  it('local mode never tries the cloud and reports a missing model as an error', async () => {
    const f = router(tags(['llama3:8b']), tags(['x']))
    const r = await probe({ ...settings, mode: 'local' }, f, CLOUD)
    expect(r.status).toBe('error')
    expect(r.errorHint).toContain('ollama pull qwen3:4b')
    expect(vi.mocked(f)).toHaveBeenCalledTimes(1)
  })

  it('cloud mode skips local; off mode probes nothing', async () => {
    const f = router(tags(['qwen3:4b']), tags(['m']))
    expect(await probe({ ...settings, mode: 'cloud' }, f, CLOUD)).toMatchObject({ status: 'live', source: 'cloud' })
    expect(await probe({ ...settings, mode: 'off' }, f, CLOUD)).toMatchObject({ status: 'sample', source: null })
    expect(vi.mocked(f)).toHaveBeenCalledTimes(1)
  })

  it('falls back to sample mode when Ollama is unreachable (not https → no blocked hint)', async () => {
    const r = await probeLocal(settings, router('down', 'down'))
    expect(r).toMatchObject({ status: 'sample', provider: null })
    expect(r.errorHint).not.toBe(BLOCKED_HINT)
  })

  it('a 429/503 from the cloud during use flips to sample via the guard, and still throws', async () => {
    const f = vi.fn(async () => new Response('{"error":"quota_exhausted"}', { status: 503 })) as unknown as typeof fetch
    const hints: string[] = []
    const p = guardCloudProvider(createOllamaProvider({ baseUrl: CLOUD, model: 'm', name: 'cloud', fetch: f }), (h) => hints.push(h))
    await expect(p.generateJson({ system: '', user: '', schema: {} })).rejects.toMatchObject({ status: 503 })
    expect(hints).toEqual([QUOTA_HINT])
    const r429 = vi.fn(async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    const q = guardCloudProvider(createOllamaProvider({ baseUrl: CLOUD, model: 'm', name: 'cloud', fetch: r429 }), (h) => hints.push(h))
    await expect(async () => {
      for await (const _ of q.streamText({ system: '', messages: [] })) void _
    }).rejects.toMatchObject({ status: 429 })
    expect(hints).toEqual([QUOTA_HINT, RATE_LIMIT_HINT])
  })
})
