// Play-Caller situation form: string inputs → a valid Situation (BUILD_PLAN §5.3.1) or inline errors.
import { getTeam } from '@/data/teams'
import type { Situation } from '@/types/generated'
import { clockText } from '@/features/shared/format'

export interface SituationForm {
  role: 'OC' | 'DC'
  offense: string
  defense: string
  season: number
  down: string
  distance: string
  yardline_100: string
  quarter: string
  clock: string
  score_diff: string
  timeouts_offense: string
  timeouts_defense: string
}

export type SituationField = Exclude<keyof SituationForm, 'role' | 'season'>
export type SituationErrors = Partial<Record<SituationField, string>>

export function formFromSituation(s: Situation): SituationForm {
  return {
    role: s.role,
    offense: s.offense,
    defense: s.defense,
    season: s.season,
    down: String(s.down),
    distance: String(s.distance),
    yardline_100: String(s.yardline_100),
    quarter: String(s.quarter),
    clock: clockText(s.clock_seconds),
    score_diff: String(s.score_diff),
    timeouts_offense: String(s.timeouts_offense),
    timeouts_defense: String(s.timeouts_defense),
  }
}

/** "m:ss" → seconds; null when malformed. */
export function parseClock(text: string): number | null {
  const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(text)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function int(text: string): number | null {
  const t = text.trim()
  return /^[+-]?\d+$/.test(t) ? Number(t) : null
}

function inRange(errors: SituationErrors, field: SituationField, text: string, lo: number, hi: number, name: string): number | null {
  const v = int(text)
  if (v === null) {
    errors[field] = `${name} must be a whole number.`
    return null
  }
  if (v < lo || v > hi) {
    errors[field] = `${name} must be between ${lo} and ${hi}.`
    return null
  }
  return v
}

export function validateSituation(f: SituationForm): { situation: Situation | null; errors: SituationErrors } {
  const errors: SituationErrors = {}
  if (!getTeam(f.offense)) errors.offense = 'Choose the offense.'
  if (!getTeam(f.defense)) errors.defense = 'Choose the defense.'
  if (!errors.offense && !errors.defense && f.offense === f.defense) errors.defense = 'The defense must be a different team.'

  const down = inRange(errors, 'down', f.down, 1, 4, 'Down')
  const yardline = inRange(errors, 'yardline_100', f.yardline_100, 1, 99, 'Yards to the end zone')
  const distance = inRange(errors, 'distance', f.distance, 1, 99, 'Distance')
  if (distance !== null && yardline !== null && distance > yardline) {
    errors.distance = `Distance can’t be more than the ${yardline} yards to the end zone.`
  }
  const quarter = inRange(errors, 'quarter', f.quarter, 1, 5, 'Quarter')
  const clock = parseClock(f.clock)
  if (clock === null) errors.clock = 'Enter the clock as m:ss, e.g. 2:10.'
  else if (clock > 900) errors.clock = 'The clock can’t be more than 15:00.'
  const scoreDiff = inRange(errors, 'score_diff', f.score_diff, -99, 99, 'Score difference')
  const toOff = inRange(errors, 'timeouts_offense', f.timeouts_offense, 0, 3, 'Timeouts')
  const toDef = inRange(errors, 'timeouts_defense', f.timeouts_defense, 0, 3, 'Timeouts')

  if (Object.keys(errors).length) return { situation: null, errors }
  return {
    errors,
    situation: {
      role: f.role,
      offense: getTeam(f.offense)!.abbr,
      defense: getTeam(f.defense)!.abbr,
      season: f.season,
      down: down!,
      distance: distance!,
      yardline_100: yardline!,
      quarter: quarter!,
      clock_seconds: clock!,
      score_diff: scoreDiff!,
      timeouts_offense: toOff!,
      timeouts_defense: toDef!,
    },
  }
}
