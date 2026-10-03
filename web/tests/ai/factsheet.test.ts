import { describe, expect, it } from 'vitest'
import { buildFactSheet, factSheetInputs, serializeFactSheet } from '@/ai'
import { formatValue, round4 } from '@/ai/factsheet'
import { goldenNames, loadGolden, SITUATION } from './helpers'

describe('fact sheet goldens (byte-identical with Python)', () => {
  it('has at least 6 goldens covering situation, matchup and team contexts', () => {
    const names = goldenNames()
    expect(names.length).toBeGreaterThanOrEqual(6)
    expect(names.some((n) => n.startsWith('situation_'))).toBe(true)
    expect(names.some((n) => n.startsWith('matchup_'))).toBe(true)
    expect(names.some((n) => n.startsWith('team_'))).toBe(true)
  })

  it.each(goldenNames())('%s', (name) => {
    const g = loadGolden(name)
    expect(serializeFactSheet(buildFactSheet(g.context, { tendencies: g.tendencies })) + '\n').toBe(g.expected)
  })
})

describe('formatting', () => {
  it.each([
    ['rate', 0.41, '41%'], ['rate', 0.285, '29%'], ['rate', 0.2849, '28%'], ['rate', 0, '0%'],
    ['rate', 1, '100%'], ['rate', -0.034, '-3%'], ['rate', -0.004, '0%'], ['rate', 0.00499, '1%'],
    ['rate', 0.005, '1%'],
    ['epa', 0.12, '+0.12'], ['epa', -0.05, '-0.05'], ['epa', 0, '0.00'], ['epa', -0.0041, '0.00'],
    ['epa', 0.005, '+0.01'], ['epa', -0.005, '-0.01'], ['epa', 1.234, '+1.23'], ['epa', -0.1257, '-0.13'],
    ['yards', 8.44, '8.4'], ['yards', 8.45, '8.5'], ['yards', 0, '0.0'], ['yards', -1.25, '-1.3'],
    ['yards', -0.04, '0.0'], ['yards', 12, '12.0'],
    ['count', 58, '58'], ['count', 0, '0'],
  ] as const)('%s %s → %s', (unit, raw, want) => {
    expect(formatValue(unit, raw)).toBe(want)
  })

  it('round4 normalizes -0 and matches Python', () => {
    expect(Object.is(round4(-0.00001), 0)).toBe(true)
    expect(JSON.stringify(round4(1))).toBe('1')
    expect(round4(0.123456)).toBe(0.1235)
  })
})

describe('factSheetInputs', () => {
  it('lists teams in block order plus NFL', () => {
    expect(factSheetInputs({ kind: 'situation', situation: SITUATION })).toEqual({ season: 2026, seasons: [2026, 2025], teams: ['KC', 'BAL', 'NFL'] })
    expect(factSheetInputs({ kind: 'situation', situation: { ...SITUATION, role: 'DC' } }).teams).toEqual(['BAL', 'KC', 'NFL'])
    expect(factSheetInputs({ kind: 'team', season: 2025, team: 'LA' })).toEqual({ season: 2025, seasons: [2025, 2024], teams: ['LA', 'NFL'] })
  })
})
