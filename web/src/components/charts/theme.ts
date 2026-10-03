/**
 * Chart theming: every color is a CSS custom property from tokens.css, so charts re-theme on
 * toggle with no re-render. Categorical slots are assigned in fixed order and never cycled.
 */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const

export const MAX_SERIES = SERIES_COLORS.length

export function seriesColor(index: number): string {
  if (index >= MAX_SERIES) throw new Error(`Chart has more than ${MAX_SERIES} series; fold extras into "Other" or facet.`)
  return SERIES_COLORS[index]
}

export const ACCENT = 'var(--accent)'
/** Neutral data mark (de-emphasized bars/dots beside accent-highlighted ones). */
export const MUTED_MARK = 'color-mix(in oklch, var(--chart-ink-muted) 45%, var(--chart-surface))'

export const axisProps = {
  stroke: 'var(--chart-axis)',
  tick: { fill: 'var(--chart-ink-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' },
  tickLine: false,
  axisLine: { stroke: 'var(--chart-axis)' },
} as const

export const gridProps = {
  stroke: 'var(--chart-grid)',
  strokeDasharray: '0',
  vertical: false,
} as const

export interface SeriesDef {
  key: string
  label: string
  /** Override color (e.g. 'var(--accent)'); defaults to the slot for this index. */
  color?: string
}

export type Formatter = (v: number) => string

export const defaultFormat: Formatter = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

/** Diverging fill: blue (positive) ↔ red (negative) through the neutral midpoint. t in [-1, 1]. */
export function divergingFill(t: number): string {
  const c = Math.max(-1, Math.min(1, t))
  const pct = Math.round(Math.abs(c) * 70) // capped so foreground text stays ≥ 4.5:1 on the fill
  return `color-mix(in oklch, ${c >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${pct}%, var(--div-mid))`
}

/** Sequential fill: low → high on one hue. t in [0, 1]. */
export function sequentialFill(t: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, t)) * 70)
  return `color-mix(in oklch, var(--seq-high) ${pct}%, var(--seq-low))`
}
