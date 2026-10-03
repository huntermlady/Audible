// Number-grounding check (shared/factsheet/SPEC.md §11). Must agree with
// ai/src/audible_ai/grounding.py on shared/factsheet/grounding_cases.json.
import type { FactSheet, Situation } from '@/types/generated'

const MASK_RE = /(?<![A-Za-z0-9_])(?:cover[ -]?[0-9]+|[0-9]+[ -]man|[0-9]{2} personnel|[0-9]-technique|[0-9]-tech)(?![A-Za-z0-9_])/gi
const TOKEN_RE =
  /(?<![A-Za-z0-9_.])(?:([0-9]{1,2}):([0-9]{2})|([0-9]+)-([0-9]+)(?![0-9])|([0-9]+)(st|nd|rd|th)(?![A-Za-z])|([+-]?)([0-9]+(?:\.[0-9]+)?|\.[0-9]+)(%?))/g

type Kind = 'pct' | 'frac' | 'num'
type Cand = readonly [value: number, kind: Kind]

export interface UngroundedToken {
  token: string
  start: number
  end: number
}

export interface GroundingResult {
  grounded: boolean
  ungrounded: UngroundedToken[]
}

function displayNumber(display: string): number {
  return Math.abs(parseFloat(display.replace('%', '').replace('+', '')))
}

export function groundingCandidates(fs: FactSheet | null, situation?: Situation | null): Cand[] {
  const out: Cand[] = []
  const addValue = (unit: string, value: number, display: string) => {
    const v = Math.abs(value)
    if (unit === 'rate') out.push([v * 100, 'pct'], [v, 'frac'], [displayNumber(display), 'pct'])
    else if (unit === 'epa') out.push([v, 'frac'], [displayNumber(display), 'frac'])
    else out.push([v, 'num'])
  }
  if (fs) {
    for (const f of fs.facts) {
      addValue(f.unit, f.value, f.display)
      if (f.league_value !== null && f.league_display !== null) addValue(f.unit, f.league_value, f.league_display)
      out.push([f.n, 'num'])
      out.push([Number(f.id.split('.')[2]), 'num']) // the fact's season (SPEC §11.3)
    }
    if (fs.context.kind !== 'situation') out.push([fs.context.season, 'num'])
  }
  if (situation) {
    const s = situation
    for (const v of [
      s.down, s.distance, s.yardline_100, 100 - s.yardline_100, s.quarter, s.clock_seconds,
      Math.abs(s.score_diff), s.timeouts_offense, s.timeouts_defense, s.season,
    ]) out.push([v, 'num'])
  }
  return out
}

function plainGrounded(x: number, decimals: number, percent: boolean, cands: Cand[]): boolean {
  const tol = 0.5 * 10 ** -decimals + 1e-9
  for (const [c, kind] of cands) {
    if (kind === 'pct' || (!percent && (kind === 'num' || (kind === 'frac' && decimals >= 1)))) {
      if (Math.abs(x - c) <= tol) return true
    }
  }
  return false
}

function decimalsOf(num: string): number {
  const dot = num.indexOf('.')
  return dot >= 0 ? num.length - dot - 1 : 0
}

/**
 * Every numeric token in `text` must come from the fact sheet or the situation. With no explicit
 * situation, a situation-context fact sheet's own situation is used.
 */
export function checkGrounding(text: string, fs: FactSheet | null, situation?: Situation | null): GroundingResult {
  const sit = situation ?? (fs && fs.context.kind === 'situation' ? fs.context.situation : null)
  const cands = groundingCandidates(fs, sit)
  const masked = text.replace(MASK_RE, (m) => ' '.repeat(m.length))
  const ungrounded: UngroundedToken[] = []
  for (const m of masked.matchAll(TOKEN_RE)) {
    const start = m.index
    const end = start + m[0].length
    let ok: boolean
    if (m[1] !== undefined) {
      ok = sit != null && Number(m[1]) * 60 + Number(m[2]) === sit.clock_seconds
    } else if (m[3] !== undefined) {
      ok = [m[3], m[4]].every((g) => plainGrounded(Number(g), 0, false, cands))
    } else if (m[5] !== undefined) {
      const v = Number(m[5])
      ok = v >= 1 && v <= 4
    } else {
      const num = m[8]
      ok = plainGrounded(Math.abs(parseFloat(num)), decimalsOf(num), m[9] === '%', cands)
    }
    if (!ok) ungrounded.push({ token: text.slice(start, end), start, end })
  }
  return { grounded: ungrounded.length === 0, ungrounded }
}
