/** "Nice" linear scale: a round step from {1, 2, 5} × 10^k, domain snapped outward to it. */
export interface NiceScale {
  domain: [number, number]
  ticks: number[]
  step: number
}

// No 2.5: its steps (e.g. 0.025) round unevenly under integer-percent formatting.
const STEPS = [1, 2, 5, 10]

/** Smallest round step ≥ rough. */
export function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1
  const mag = 10 ** Math.floor(Math.log10(rough))
  return STEPS.find((s) => s * mag >= rough * (1 - 1e-9))! * mag
}

// Strip float noise (0.1 + 0.2) by rounding to the step's decimal places.
const roundTo = (v: number, step: number) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2)
  return Number(v.toFixed(decimals)) || 0 // || 0 turns -0 into 0
}

/**
 * Pad [min, max] by `pad` × range (so edge points aren't clipped), then pick a round step for
 * about `targetTicks` intervals and snap the domain outward to multiples of it.
 */
export function niceScale(min: number, max: number, { pad = 0.06, targetTicks = 5 } = {}): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: [0, 1], ticks: [0, 1], step: 1 }
  if (min > max) [min, max] = [max, min]
  const span = max - min || Math.abs(max) || 1
  const lo = min - span * pad
  const hi = max + span * pad
  const step = niceStep((hi - lo) / targetTicks)
  const start = roundTo(Math.floor(lo / step + 1e-9) * step, step)
  const end = roundTo(Math.ceil(hi / step - 1e-9) * step, step)
  const ticks: number[] = []
  for (let i = 0, v = start; v <= end + step * 1e-6 && i < 100; i++, v = start + i * step) ticks.push(roundTo(v, step))
  return { domain: [start, end], ticks, step }
}
