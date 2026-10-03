// Display helpers for data rows (not AI output: AI numbers always come from fact `display` strings).
import type { CallOption, TeamTendencyRow } from '@/types/generated'

export type Maybe<T> = T | null | undefined

const isNum = (v: Maybe<number>): v is number => typeof v === 'number' && Number.isFinite(v)

/** 0.412 → "41%". null → null (so <Stat> shows "not available for this season"). */
export function pct(v: Maybe<number>, digits = 0): string | null {
  return isNum(v) ? `${(v * 100).toFixed(digits)}%` : null
}

/** Signed with fixed decimals: +0.12 / -0.05 / 0.00. */
export function signed(v: Maybe<number>, digits = 2): string | null {
  if (!isNum(v)) return null
  const s = v.toFixed(digits)
  return Number(s) === 0 ? (0).toFixed(digits) : v > 0 ? `+${s}` : s
}

/** Signed percentage points, for rates over expected (PROE): +4% / -2%. */
export function signedPct(v: Maybe<number>, digits = 0): string | null {
  if (!isNum(v)) return null
  const s = (v * 100).toFixed(digits)
  return Number(s) === 0 ? `${(0).toFixed(digits)}%` : v > 0 ? `+${s}%` : `${s}%`
}

export function num(v: Maybe<number>, digits = 0): string | null {
  return isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : null
}

/** Chart formatters (charts only call them with numbers). */
export const fmtPct = (v: number) => pct(v) ?? ''
export const fmtEpa = (v: number) => signed(v) ?? ''
export const fmtSignedPct = (v: number) => signedPct(v) ?? ''

export const DOWN_LABEL: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }

type Dist = NonNullable<TeamTendencyRow['dist_bucket']>
type Zone = NonNullable<TeamTendencyRow['field_zone']>
type ScoreState = NonNullable<TeamTendencyRow['score_state']>
type TimeBucket = NonNullable<TeamTendencyRow['time_bucket']>

export const DISTS: Dist[] = ['short', 'medium', 'long', 'very_long']
export const DIST_LABEL: Record<Dist, string> = { short: 'Short 1–3', medium: 'Med 4–6', long: 'Long 7–10', very_long: '11+' }
export const ZONES: Zone[] = ['backed_up', 'own_territory', 'opp_territory', 'red_zone']
export const ZONE_LABEL: Record<Zone, string> = { backed_up: 'Backed up', own_territory: 'Own territory', opp_territory: 'Opp. territory', red_zone: 'Red zone' }
export const SCORE_STATES: ScoreState[] = ['trail_9plus', 'trail_1_8', 'tied', 'lead_1_8', 'lead_9plus']
export const SCORE_LABEL: Record<ScoreState, string> = { trail_9plus: 'Trail 9+', trail_1_8: 'Trail 1–8', tied: 'Tied', lead_1_8: 'Lead 1–8', lead_9plus: 'Lead 9+' }
export const TIME_BUCKETS: TimeBucket[] = ['normal', 'fourth_quarter', 'two_minute']
export const TIME_LABEL: Record<TimeBucket, string> = { normal: 'Normal', fourth_quarter: '4th quarter', two_minute: 'Two-minute' }

type PlayFamily = NonNullable<CallOption['play_family']>
export const PLAY_FAMILY_LABEL: Record<PlayFamily, string> = {
  inside_run: 'Inside run',
  outside_run: 'Outside run',
  qb_run: 'QB run',
  screen: 'Screen',
  quick_pass: 'Quick pass',
  intermediate_pass: 'Intermediate pass',
  deep_pass: 'Deep pass',
  play_action: 'Play action',
  sneak: 'QB sneak',
  punt: 'Punt',
  field_goal: 'Field goal',
}
export const FRONT_LABEL: Record<NonNullable<CallOption['front']>, string> = { even: 'Even front', odd: 'Odd front', bear: 'Bear front', dime_sub: 'Dime sub' }
export const COVERAGE_LABEL: Record<NonNullable<CallOption['coverage_shell']>, string> = {
  cover0: 'Cover 0',
  cover1: 'Cover 1',
  cover2: 'Cover 2',
  cover3: 'Cover 3',
  cover4: 'Cover 4',
  cover6: 'Cover 6',
  two_man: '2-Man',
}
export const PRESSURE_LABEL: Record<NonNullable<CallOption['pressure']>, string> = { none: 'Four-man rush', sim: 'Simulated pressure', blitz: 'Blitz' }

/** Headline for a call option: "Screen · left" (OC) or "Odd front · Cover 1 · Blitz" (DC). */
export function callTitle(o: Pick<CallOption, 'play_family' | 'direction' | 'front' | 'coverage_shell' | 'pressure'>): string {
  if (o.play_family) return [PLAY_FAMILY_LABEL[o.play_family], o.direction].filter(Boolean).join(' · ')
  return [o.front && FRONT_LABEL[o.front], o.coverage_shell && COVERAGE_LABEL[o.coverage_shell], o.pressure && PRESSURE_LABEL[o.pressure]]
    .filter(Boolean)
    .join(' · ')
}

/** 130 → "2:10". */
export function clockText(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function quarterText(q: number): string {
  return q === 5 ? 'OT' : `Q${q}`
}

/** "2026-09-27" → "Sun, Sep 27" (parsed as a calendar date, not UTC midnight). */
export function gameDayText(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "13:00" → "1:00 PM". */
export function gameTimeText(t: Maybe<string>): string | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return t
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

/** ISO timestamp → "Sep 22". */
export function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
