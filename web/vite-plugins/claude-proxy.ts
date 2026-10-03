import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { loadEnv, type Plugin } from 'vite'

const UPSTREAM = 'https://api.anthropic.com/v1/messages'
const MAX_TOKENS = 8192
const MAX_BODY_BYTES = 1_000_000

function sendError(res: ServerResponse, status: number, type: string, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: { type, message } }))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Validates the request body per the T2 spec; returns an error message or null. */
export function validateClaudeBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body must be a JSON object'
  const { model, max_tokens } = body as { model?: unknown; max_tokens?: unknown }
  if (typeof model !== 'string' || !model.startsWith('claude-')) return 'model must be a string starting with "claude-"'
  if (typeof max_tokens === 'number' && max_tokens > MAX_TOKENS) return `max_tokens must be <= ${MAX_TOKENS}`
  return null
}

/**
 * Dev-only `POST /__claude` → Anthropic Messages API (spec: docs/HANDOFFS.md, T2→T3).
 * ANTHROPIC_API_KEY comes from the repo-root `.env` on the server; it is never logged, never
 * exposed to the client, and this plugin does not exist in build/preview.
 */
export function claudeDevProxy(repoRoot: string): Plugin {
  let mode = 'development'
  return {
    name: 'audible:claude-dev-proxy',
    apply: 'serve',
    configResolved(config) {
      mode = config.mode
    },
    configureServer(server) {
      server.middlewares.use('/__claude', (req, res) => {
        void (async () => {
          if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST')
            return sendError(res, 405, 'method_not_allowed', 'Use POST')
          }
          let body: unknown
          let raw: string
          try {
            raw = await readBody(req)
            body = JSON.parse(raw)
          } catch {
            return sendError(res, 400, 'invalid_request', 'Body must be JSON (max 1 MB)')
          }
          const invalid = validateClaudeBody(body)
          if (invalid) return sendError(res, 400, 'invalid_request', invalid)

          // Re-read each request so editing .env doesn't need a server restart.
          const key = loadEnv(mode, repoRoot, '').ANTHROPIC_API_KEY
          if (!key) return sendError(res, 503, 'missing_key', 'ANTHROPIC_API_KEY is not set in .env')

          const abort = new AbortController()
          res.on('close', () => abort.abort())
          let upstream: Response
          try {
            upstream = await fetch(UPSTREAM, {
              method: 'POST',
              headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
              body: raw,
              signal: abort.signal,
            })
          } catch (e) {
            if (abort.signal.aborted) return
            return sendError(res, 502, 'upstream_unreachable', e instanceof Error ? e.message : 'fetch failed')
          }

          res.statusCode = upstream.status
          const ct = upstream.headers.get('content-type')
          if (ct) res.setHeader('Content-Type', ct)
          res.setHeader('Cache-Control', 'no-cache')
          res.flushHeaders()
          if (!upstream.body) return res.end()
          // Unbuffered pass-through: each upstream chunk is written as it arrives.
          Readable.fromWeb(upstream.body as unknown as WebReadableStream)
            .on('error', () => res.destroy())
            .pipe(res)
        })()
      })
    },
  }
}
