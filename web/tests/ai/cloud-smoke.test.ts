import { describe, expect, it } from 'vitest'
import { createOllamaProvider, runCoordinatorCall } from '@/ai'
import { sampleTendencies, SITUATION } from './helpers'

// Opt-in smoke test against a running audible-ai Worker (e.g. `npm --prefix worker run dev:remote`).
// Run: CLOUD_SMOKE_URL=http://localhost:8788 npm --prefix web test -- --run tests/ai/cloud-smoke
const URL_ = process.env.CLOUD_SMOKE_URL

describe.skipIf(!URL_)('cloud Worker smoke (real Workers AI)', () => {
  const nodeFetch: typeof fetch = (...a) => fetch(...a)

  it('lists a model, streams chat, and returns a validated Play-Caller call', { timeout: 120_000 }, async () => {
    const tags = (await (await fetch(`${URL_}/api/tags`)).json()) as { models: { name: string }[] }
    const model = tags.models[0].name
    const provider = createOllamaProvider({ baseUrl: URL_, model, name: 'cloud', fetch: nodeFetch })

    let chat = ''
    for await (const t of provider.streamText({ system: 'Answer in one short sentence.', messages: [{ role: 'user', content: 'What is a screen pass?' }] })) chat += t
    console.log(`[smoke] chat (${model}): ${chat}`)
    expect(chat.length).toBeGreaterThan(10)
    expect(chat).not.toContain('<think>')

    const r = await runCoordinatorCall({ situation: { ...SITUATION, season: 2026 }, tendencies: sampleTendencies(), provider })
    console.log(`[smoke] play-caller ok=${r.ok} attempts=${r.attempts}`, r.ok ? `ft=${r.firstTokenMs}ms total=${r.latencyMs}ms` : r.errors)
    if (r.ok) console.log('[smoke] call:', JSON.stringify(r.call.primary), r.call.rationale.map((x) => x.text))
    expect(r.ok).toBe(true)
  })
})
