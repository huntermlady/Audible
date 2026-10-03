import { describe, expect, it, vi } from 'vitest'
import { buildFactSheet, runCoordinatorCall, validateCall, type GenerateResult, type Provider } from '@/ai'
import { modelSchema } from '@/ai/schemas'
import { sampleTendencies, SITUATION, validCall } from './helpers'

const result = (parsed: Record<string, unknown> | null): GenerateResult => ({
  rawText: JSON.stringify(parsed), parsed, latencyMs: 5, firstTokenMs: 2, promptTokens: 10, outputTokens: 20,
})

function scripted(responses: Array<GenerateResult | Error>) {
  const requests: { user: string; schema: object }[] = []
  const provider: Provider = {
    name: 'ollama',
    model: 'scripted',
    generateJson: vi.fn(async (req) => {
      requests.push({ user: req.user, schema: req.schema })
      const next = responses.shift()!
      if (next instanceof Error) throw next
      return next
    }),
    streamText: async function* () {},
    health: async () => ({ ok: true }),
  }
  return { provider, requests }
}

const fs = () => buildFactSheet({ kind: 'situation', situation: SITUATION }, { tendencies: sampleTendencies() })

describe('validateCall', () => {
  it('accepts a grounded call and rejects bad ones', () => {
    const sheet = fs()
    expect(validateCall(validCall(sheet), sheet, SITUATION).ok).toBe(true)
    const bad = validCall(sheet)
    bad.caveats = ['They convert 97.3% of these.']
    bad.rationale[0].stat_ids = ['KC.off.2026.overall.all.blitz_rate']
    const r = validateCall(bad, sheet, SITUATION)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('unknown stat_id'))).toBe(true)
      expect(r.errors.some((e) => e.includes("'97.3%'"))).toBe(true)
    }
    const dc = validateCall(validCall(sheet, 'DC'), sheet)
    expect(dc.ok).toBe(false)
  })
})

describe('modelSchema', () => {
  it('inlines refs and constrains stat_ids to the fact ids', () => {
    const ids = fs().facts.map((f) => f.id)
    const text = JSON.stringify(modelSchema(ids))
    expect(text).not.toContain('$ref')
    expect(text).not.toContain('"pattern"')
    const s = modelSchema(ids) as { properties: { rationale: { items: { properties: { stat_ids: { items: unknown } } } } } }
    expect(s.properties.rationale.items.properties.stat_ids.items).toEqual({ type: 'string', enum: ids })
  })

  it('pins the role fields when a role is given', () => {
    type Opt = Record<string, { type: string; enum?: unknown[] }>
    const oc = modelSchema(['a'], 'OC') as { properties: { role: unknown; primary: { properties: Opt } } }
    expect(oc.properties.role).toEqual({ type: 'string', enum: ['OC'] })
    const p = oc.properties.primary.properties
    expect([p.front, p.coverage_shell, p.pressure]).toEqual([{ type: 'null' }, { type: 'null' }, { type: 'null' }])
    expect(p.play_family.enum).not.toContain(null)
    const dc = modelSchema(['a'], 'DC') as { properties: { alternatives: { items: { properties: Opt } } } }
    const alt = dc.properties.alternatives.items.properties
    expect(alt.play_family).toEqual({ type: 'null' })
    expect(alt.pressure.enum).toEqual(['none', 'sim', 'blitz'])
    expect(alt.when).toBeDefined()
  })
})

describe('runCoordinatorCall', () => {
  it('returns on a valid first attempt', async () => {
    const sheet = fs()
    const { provider } = scripted([result(validCall(sheet))])
    const r = await runCoordinatorCall({ situation: SITUATION, tendencies: sampleTendencies(), provider })
    expect(r.ok).toBe(true)
    if (r.ok) expect([r.attempts, r.firstTokenMs]).toEqual([1, 2])
  })

  it('retries once with the validation errors appended', async () => {
    const sheet = fs()
    const bad = validCall(sheet)
    bad.caveats = ['They convert 97.3% of these.']
    const { provider, requests } = scripted([result(bad), result(validCall(sheet))])
    const r = await runCoordinatorCall({ situation: SITUATION, tendencies: sampleTendencies(), provider })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
    expect(requests[1].user.startsWith(requests[0].user)).toBe(true)
    expect(requests[1].user).toContain('failed validation')
    expect(requests[1].user).toContain('97.3%')
  })

  it('fails after the second invalid response', async () => {
    const { provider } = scripted([result(null), new Error('HTTP 500')])
    const r = await runCoordinatorCall({ situation: SITUATION, tendencies: sampleTendencies(), provider })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.attempts).toBe(2)
      expect(r.errors[0]).toContain('provider error: HTTP 500')
      expect(r.factSheet.facts.length).toBeGreaterThan(0)
    }
  })

  it('throws AbortError when cancelled', async () => {
    const ctrl = new AbortController()
    const provider: Provider = {
      name: 'ollama',
      model: 'x',
      generateJson: async () => {
        ctrl.abort()
        throw new DOMException('aborted', 'AbortError')
      },
      streamText: async function* () {},
      health: async () => ({ ok: true }),
    }
    await expect(
      runCoordinatorCall({ situation: SITUATION, tendencies: sampleTendencies(), provider, signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
