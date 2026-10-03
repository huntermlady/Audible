import type { Page, Route } from '@playwright/test'
import { AI_API, expect, gotoReady, test } from './fixtures'

// Cloud live mode (CONTRACT_CHANGES #18–20): local Ollama is unreachable, the Cloudflare Worker at
// VITE_AI_CLOUD_URL answers. The Worker is stubbed here with its Ollama-compatible API, so the build's
// cloud URL (whatever it is) is never really called. A build without VITE_AI_CLOUD_URL never probes
// the cloud; those tests skip unless E2E_REQUIRE_CLOUD=1 (set it in CI for builds that have the URL).

const MODEL = 'e2e-stub-model'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const FACT_LINE = /^- ([A-Z]{2,3}\.(?:off|def)\.\d{4}\.[a-z_]+\.[a-z0-9_-]+\.[a-z_]+) \|/gm

interface ChatBody {
  messages: { role: string; content: string }[]
  stream?: boolean
  format?: unknown
}

/** A CoordinatorCall that cites real fact IDs from the prompt and has no numbers in its prose (so it's grounded). */
function stubCall(body: ChatBody) {
  const text = body.messages.map((m) => m.content).join('\n')
  const ids = [...text.matchAll(FACT_LINE)].map((m) => m[1])
  if (ids.length === 0) throw new Error('stub: no fact IDs in the prompt')
  const oc = /Offensive Coordinator/.test(text)
  const primary = oc
    ? { play_family: 'quick_pass', direction: 'right', concept: 'E2E stub quick game', front: null, coverage_shell: null, pressure: null }
    : { play_family: null, direction: null, concept: 'E2E stub two-high shell', front: 'even', coverage_shell: 'cover4', pressure: 'sim' }
  return {
    role: oc ? 'OC' : 'DC',
    primary,
    alternatives: [],
    rationale: [
      { text: 'The stub leans on the first fact in the sheet.', stat_ids: [ids[0]] },
      { text: 'The stub also cites a second fact for support.', stat_ids: [ids[1] ?? ids[0]] },
    ],
    confidence: 'medium',
    caveats: [],
  }
}

function ndjson(content: string): string {
  const chunks = content.match(/[\s\S]{1,40}/g) ?? ['']
  const lines: Record<string, unknown>[] = chunks.map((c) => ({ model: MODEL, message: { role: 'assistant', content: c }, done: false }))
  lines.push({ model: MODEL, message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: null, eval_count: null })
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

interface CloudStub {
  /** Resolves once the app has probed the cloud /api/tags. */
  probed: Promise<void>
  chatCalls: number
}

/** Local Ollama refuses; every other /api/tags + /api/chat is the stub Worker. `chat` overrides /api/chat. */
async function stubCloud(page: Page, chat?: (route: Route) => Promise<void>): Promise<CloudStub> {
  let markProbed!: () => void
  const stub: CloudStub = { probed: new Promise((r) => (markProbed = r)), chatCalls: 0 }
  await page.route(AI_API, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && url.port === '11434') return route.abort('connectionrefused')
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (url.pathname.endsWith('/api/tags')) {
      markProbed()
      return route.fulfill({ json: { models: [{ name: MODEL }] }, headers: CORS })
    }
    stub.chatCalls++
    if (chat) return chat(route)
    const body = req.postDataJSON() as ChatBody
    // Structured calls send `format` (the CoordinatorCall schema); chat is free text.
    const content = body.format ? JSON.stringify(stubCall(body)) : 'Stub coordinator reply with no numbers in it.'
    if (body.stream === false) {
      return route.fulfill({ json: { model: MODEL, message: { role: 'assistant', content }, done: true, prompt_eval_count: null, eval_count: null }, headers: CORS })
    }
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', headers: CORS, body: ndjson(content) })
  })
  return stub
}

/** Skips (or fails, with E2E_REQUIRE_CLOUD=1) when this build has no cloud URL to probe. */
async function requireCloudProbe(stub: CloudStub) {
  const probed = await Promise.race([stub.probed.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8_000))])
  if (!probed && process.env.E2E_REQUIRE_CLOUD) throw new Error('The app never probed the cloud /api/tags: was the build made with VITE_AI_CLOUD_URL?')
  test.skip(!probed, 'Build has no VITE_AI_CLOUD_URL (rebuild with it, or set E2E_REQUIRE_CLOUD=1 to fail instead)')
}

const pill = (page: Page) => page.getByRole('button', { name: /^AI status:/ })

test.describe('cloud live mode (Ollama down, Worker up)', () => {
  test('pill shows Live · Cloud and the Play-Caller returns a grounded live call', async ({ page, consoleErrors }) => {
    const stub = await stubCloud(page)
    await gotoReady(page, 'play-caller', /play-caller/i)
    await requireCloudProbe(stub)

    await expect(pill(page)).toHaveAccessibleName(/Live · Cloud/)
    await expect(pill(page)).toHaveAttribute('data-ai-status', 'live')
    await expect(pill(page)).toHaveAttribute('data-ai-source', 'cloud')
    await expect(page.getByTestId('sample-banner')).toHaveCount(0)

    const get = page.getByRole('button', { name: 'Get the offensive call' })
    await expect(get).toBeEnabled()
    await get.click()
    await expect(page.getByText('E2E stub quick game').first()).toBeVisible()
    await expect(page.getByText(/couldn’t produce a valid call/)).toHaveCount(0)
    expect(stub.chatCalls).toBe(1) // valid on the first attempt: no validation retry
    expect(consoleErrors).toEqual([])
  })

  test('chat is enabled in cloud mode', async ({ page }) => {
    const stub = await stubCloud(page)
    await gotoReady(page, 'play-caller', /play-caller/i)
    await requireCloudProbe(stub)

    await page.getByRole('button', { name: 'Open coordinator chat' }).click()
    const drawer = page.locator('#chat-drawer')
    const box = drawer.getByRole('textbox', { name: 'Message' })
    await expect(box).toBeEnabled()
    await box.fill('What does the offense like here?')
    await drawer.getByRole('button', { name: 'Send message' }).click()
    await expect(drawer.getByText('Stub coordinator reply with no numbers in it.')).toBeVisible()
  })

  test('an exhausted free quota drops back to sample mode with an explanation', async ({ page }) => {
    const stub = await stubCloud(page, (route) =>
      route.fulfill({ status: 503, headers: CORS, json: { error: 'quota_exhausted', message: 'Workers AI daily allocation used up' } }),
    )
    await gotoReady(page, 'play-caller', /play-caller/i)
    await requireCloudProbe(stub)

    await page.getByRole('button', { name: 'Get the offensive call' }).click()
    await expect(page.getByTestId('sample-banner').first()).toBeVisible()
    await expect(page.getByTestId('sample-banner').first()).toContainText(/allowance is used up/i)
    await expect(pill(page)).toHaveAttribute('data-ai-status', 'sample')
    await expect(page.getByRole('button', { name: 'Live AI is off' })).toBeDisabled()
  })
})
