import { niceScale, niceStep } from '@/components/charts'

describe('niceStep', () => {
  it.each([
    [0.037, 0.05],
    [0.05, 0.05],
    [0.13, 0.2],
    [0.22, 0.5],
    [0.3, 0.5],
    [7, 10],
    [12, 20],
  ])('%s → %s', (rough, step) => expect(niceStep(rough)).toBeCloseTo(step, 12))
})

describe('niceScale', () => {
  const isMultiple = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-9

  it.each([
    [-0.33, 0.21], // EPA-like (the uneven -0.37/-0.17/+0.03 case)
    [-0.052, 0.18],
    [0.39, 0.51], // success rate
    [0.012, 0.087],
    [3, 97],
    [-12.4, 8.9],
    [0.5, 0.5], // single value
  ])('[%s, %s]: round ticks, domain covers the padded data', (min, max) => {
    const { domain, ticks, step } = niceScale(min, max)
    expect(ticks[0]).toBe(domain[0])
    expect(ticks.at(-1)).toBe(domain[1])
    for (const t of ticks) expect(isMultiple(t, step)).toBe(true)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 9)
    const span = max - min || Math.abs(max) || 1
    expect(domain[0]).toBeLessThanOrEqual(min - span * 0.06 + 1e-12)
    expect(domain[1]).toBeGreaterThanOrEqual(max + span * 0.06 - 1e-12)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.length).toBeLessThanOrEqual(11)
    // No float noise like 0.30000000000000004
    for (const t of ticks) expect(String(t).length).toBeLessThan(8)
  })

  it('gives clean EPA ticks', () => {
    expect(niceScale(-0.33, 0.21).ticks).toEqual([-0.4, -0.2, 0, 0.2, 0.4])
    expect(niceScale(0.39, 0.51).ticks).toEqual([0.35, 0.4, 0.45, 0.5, 0.55])
  })

  it('handles reversed and non-finite input', () => {
    expect(niceScale(0.2, -0.1).domain[0]).toBeLessThan(-0.1)
    expect(niceScale(NaN, 1)).toEqual({ domain: [0, 1], ticks: [0, 1], step: 1 })
  })
})

describe('niceScale ticks format cleanly as whole percents', () => {
  it.each([
    [0.39, 0.51],
    [0.2, 0.62],
    [0.41, 0.47],
  ])('[%s, %s]', (min, max) => {
    const pcts = niceScale(min, max).ticks.map((t) => t * 100)
    for (const p of pcts) expect(Math.abs(p - Math.round(p))).toBeLessThan(1e-9)
    const gaps = new Set(pcts.slice(1).map((p, i) => Math.round(p - pcts[i])))
    expect(gaps.size).toBe(1) // evenly spaced labels
  })
})
