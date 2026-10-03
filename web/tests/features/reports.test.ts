import { describe, expect, it } from 'vitest'
import { featuredReport, isStale, matchupReportSlots, visibleReports } from '@/features/reports/reports'
import type { ReportIndexEntry } from '@/types/generated'

const entry = (p: Partial<ReportIndexEntry>): ReportIndexEntry => ({
  season: 2026, week: 4, game_id: '2026_04_KC_BAL', team: 'KC', opponent: 'BAL', role: 'OC',
  path: '2026/4/2026_04_KC_BAL.KC.OC.json', generated_at: '2026-09-22T03:12:00Z', stats_as_of: '2026-09-21',
  model: 'm', validation_status: 'passed', ...p,
})
const M = { current_season: 2026, current_week: 4 }

describe('report filtering', () => {
  it('never shows failed reports', () => {
    const index = [entry({}), entry({ team: 'BAL', opponent: 'KC', role: 'DC', validation_status: 'failed' })]
    expect(visibleReports(index)).toHaveLength(1)
    const slots = matchupReportSlots(index, '2026_04_KC_BAL', 'KC', 'BAL', M)
    expect(slots.map((s) => `${s.team} ${s.role} ${s.entry ? 'y' : 'n'}`)).toEqual(['KC OC y', 'KC DC n', 'BAL OC n', 'BAL DC n'])
  })

  it('hides a failed rerun even when an older passing report exists for another game', () => {
    const index = [entry({ validation_status: 'failed' }), entry({ game_id: '2026_03_KC_ATL', week: 3 })]
    expect(matchupReportSlots(index, '2026_04_KC_BAL', 'KC', 'BAL', M)[0].entry).toBeNull()
  })

  it('labels reports for earlier weeks and seasons as stale', () => {
    expect(isStale({ season: 2026, week: 4 }, M)).toBe(false)
    expect(isStale({ season: 2026, week: 3 }, M)).toBe(true)
    expect(isStale({ season: 2025, week: 18 }, M)).toBe(true)
    const slots = matchupReportSlots([entry({ week: 3, game_id: 'g' })], 'g', 'KC', 'BAL', M)
    expect(slots[0].entry?.stale).toBe(true)
  })

  it('prefers the newest run for a slot', () => {
    const index = [entry({ path: 'old' }), entry({ path: 'new', generated_at: '2026-09-23T00:00:00Z' })]
    expect(matchupReportSlots(index, '2026_04_KC_BAL', 'KC', 'BAL', M)[0].entry?.path).toBe('new')
  })

  it('features a fresh report over a stale one and skips failed ones', () => {
    const index = [
      entry({ week: 3, game_id: 'old', path: 'old' }),
      entry({ game_id: 'bad', path: 'bad', validation_status: 'failed' }),
      entry({ game_id: 'cur', path: 'cur', role: 'DC' }),
    ]
    expect(featuredReport(index, M)).toMatchObject({ path: 'cur', stale: false })
    expect(featuredReport([entry({ week: 2 })], M)?.stale).toBe(true)
    expect(featuredReport([entry({ validation_status: 'failed' })], M)).toBeNull()
  })
})
