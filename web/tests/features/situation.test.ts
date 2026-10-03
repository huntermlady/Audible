import { describe, expect, it } from 'vitest'
import { formFromSituation, parseClock, validateSituation, type SituationForm } from '@/features/playcaller/situation'
import type { Situation } from '@/types/generated'

const BASE: Situation = {
  role: 'OC', offense: 'KC', defense: 'BAL', season: 2026, down: 3, distance: 7, yardline_100: 35,
  quarter: 4, clock_seconds: 130, score_diff: -4, timeouts_offense: 1, timeouts_defense: 2,
}
const form = (patch: Partial<SituationForm> = {}): SituationForm => ({ ...formFromSituation(BASE), ...patch })

describe('Play-Caller situation form', () => {
  it('round-trips a valid situation', () => {
    const f = form()
    expect(f.clock).toBe('2:10')
    expect(validateSituation(f)).toEqual({ situation: BASE, errors: {} })
  })

  it('rejects a distance longer than the yards to the end zone', () => {
    const r = validateSituation(form({ distance: '12', yardline_100: '8' }))
    expect(r.situation).toBeNull()
    expect(r.errors.distance).toMatch(/8 yards to the end zone/)
    expect(validateSituation(form({ distance: '8', yardline_100: '8' })).situation?.distance).toBe(8)
  })

  it.each([
    ['down', '5', /between 1 and 4/],
    ['down', '0', /between 1 and 4/],
    ['distance', '0', /between 1 and 99/],
    ['distance', '2.5', /whole number/],
    ['yardline_100', '100', /between 1 and 99/],
    ['quarter', '6', /between 1 and 5/],
    ['score_diff', 'abc', /whole number/],
    ['timeouts_offense', '4', /between 0 and 3/],
    ['timeouts_defense', '-1', /between 0 and 3/],
  ] as const)('%s = %s is invalid', (field, value, msg) => {
    const r = validateSituation(form({ [field]: value }))
    expect(r.situation).toBeNull()
    expect(r.errors[field]).toMatch(msg)
  })

  it('validates the clock format and range', () => {
    expect(parseClock('2:10')).toBe(130)
    expect(parseClock('0:05')).toBe(5)
    expect(parseClock('15:00')).toBe(900)
    expect(parseClock('2:60')).toBeNull()
    expect(parseClock('130')).toBeNull()
    expect(validateSituation(form({ clock: '2:7' })).errors.clock).toMatch(/m:ss/)
    expect(validateSituation(form({ clock: '15:01' })).errors.clock).toMatch(/15:00/)
  })

  it('requires two different, known teams', () => {
    expect(validateSituation(form({ defense: 'KC' })).errors.defense).toMatch(/different team/)
    expect(validateSituation(form({ offense: 'XYZ' })).errors.offense).toBeDefined()
  })

  it('reports every invalid field at once', () => {
    const r = validateSituation(form({ down: '9', clock: 'soon', distance: '50', yardline_100: '10' }))
    expect(Object.keys(r.errors).sort()).toEqual(['clock', 'distance', 'down'])
  })
})
