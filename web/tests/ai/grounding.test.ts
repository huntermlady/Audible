import { describe, expect, it } from 'vitest'
import { checkGrounding } from '@/ai'
import type { FactSheet, Situation } from '@/types/generated'
import { readJson } from './helpers'

interface Case {
  id: string
  fact_sheet: string | null
  situation: Situation | null
  text: string
  expected_ungrounded: string[]
  expected_grounded: boolean
}
const data = readJson<{ fact_sheets: Record<string, FactSheet>; cases: Case[] }>('shared/factsheet/grounding_cases.json')

describe('grounding parity cases', () => {
  it('has at least 30 cases', () => expect(data.cases.length).toBeGreaterThanOrEqual(30))

  it.each(data.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const fs = c.fact_sheet ? data.fact_sheets[c.fact_sheet] : null
    const r = checkGrounding(c.text, fs, c.situation)
    expect(r.ungrounded.map((u) => u.token)).toEqual(c.expected_ungrounded)
    expect(r.grounded).toBe(c.expected_grounded)
    for (const u of r.ungrounded) expect(c.text.slice(u.start, u.end)).toBe(u.token)
  })
})
