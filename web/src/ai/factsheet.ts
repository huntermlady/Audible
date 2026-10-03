// Fact sheet builder. Implements shared/factsheet/SPEC.md and must stay byte-identical to
// ai/src/audible_ai/factsheet.py; both are checked against shared/factsheet/goldens.
import type {
  Fact,
  FactSheet,
  FactSheetContext,
  FactSheetDerived,
  Situation,
  TeamTendencyRow,
} from '@/types/generated'

export const FACT_SHEET_VERSION = '1.1.0'
export const MAX_FACTS = 40

type Side = 'off' | 'def'
type Unit = Fact['unit']
type MetricTable = Record<Side, readonly string[]>
type Candidate = readonly [grouping: string, cellKey: string]

const SITUATION_KEYS = [
  'role', 'offense', 'defense', 'season', 'down', 'distance', 'yardline_100', 'quarter',
  'clock_seconds', 'score_diff', 'timeouts_offense', 'timeouts_defense',
] as const

const EPA_METRICS = new Set(['epa_per_play', 'pass_epa', 'run_epa'])

const METRIC_LABELS: Record<string, string> = {
  plays: 'plays',
  pass_rate: 'pass rate',
  proe: 'pass rate over expected',
  epa_per_play: 'EPA/play',
  success_rate: 'success rate',
  explosive_rate: 'explosive-play rate',
  pass_epa: 'EPA/dropback',
  run_epa: 'EPA/run',
  pass_success_rate: 'dropback success rate',
  run_success_rate: 'run success rate',
  avg_air_yards: 'average air yards',
  deep_pass_rate: 'deep pass rate',
  screen_rate: 'screen rate',
  play_action_rate: 'play-action rate',
  shotgun_rate: 'shotgun rate',
  no_huddle_rate: 'no-huddle rate',
  run_left_rate: 'share of runs left',
  run_middle_rate: 'share of runs middle',
  run_right_rate: 'share of runs right',
  pass_left_rate: 'share of passes left',
  pass_middle_rate: 'share of passes middle',
  pass_right_rate: 'share of passes right',
  sack_rate: 'sack rate',
  blitz_rate: 'blitz rate',
  pressure_rate: 'pressure rate',
  man_rate: 'man coverage rate',
  zone_rate: 'zone coverage rate',
}

const DOWN_LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }
const DIST_LABELS: Record<string, string> = { short: 'short', medium: 'medium', long: 'long', very_long: 'very long' }
const ZONE_LABELS: Record<string, string> = {
  backed_up: 'backed up',
  own_territory: 'own territory',
  opp_territory: 'opponent territory',
  red_zone: 'red zone',
}
const SCORE_LABELS: Record<string, string> = {
  trail_9plus: 'trailing by two scores or more',
  trail_1_8: 'trailing by one score',
  tied: 'tied',
  lead_1_8: 'leading by one score',
  lead_9plus: 'leading by two scores or more',
}
const TIME_LABELS: Record<string, string> = { two_minute: 'two-minute', fourth_quarter: 'fourth quarter', normal: 'normal clock' }

const SITUATION_METRICS: Record<string, MetricTable> = {
  situational: {
    off: ['pass_rate', 'proe', 'success_rate', 'pass_success_rate', 'run_success_rate', 'epa_per_play', 'explosive_rate', 'sack_rate', 'screen_rate'],
    def: ['success_rate', 'pass_success_rate', 'run_success_rate', 'epa_per_play', 'explosive_rate', 'sack_rate', 'blitz_rate', 'pressure_rate', 'man_rate'],
  },
  zone: {
    off: ['pass_rate', 'success_rate', 'epa_per_play'],
    def: ['success_rate', 'epa_per_play', 'pass_success_rate'],
  },
  score_time: {
    off: ['pass_rate', 'success_rate', 'no_huddle_rate'],
    def: ['success_rate', 'blitz_rate', 'zone_rate'],
  },
  overall: {
    off: ['epa_per_play', 'success_rate', 'pass_rate', 'proe', 'explosive_rate'],
    def: ['epa_per_play', 'success_rate', 'explosive_rate', 'blitz_rate', 'pressure_rate'],
  },
}

const MATCHUP_METRICS: Record<string, MetricTable> = {
  overall: SITUATION_METRICS.overall,
  early_down: {
    off: ['pass_rate', 'proe', 'success_rate', 'play_action_rate'],
    def: ['success_rate', 'run_success_rate', 'pass_success_rate', 'explosive_rate'],
  },
  third_short: {
    off: ['pass_rate', 'success_rate', 'run_success_rate'],
    def: ['success_rate', 'run_success_rate', 'blitz_rate'],
  },
  third_long: {
    off: ['pass_success_rate', 'sack_rate', 'screen_rate'],
    def: ['pass_success_rate', 'blitz_rate', 'man_rate'],
  },
  red_zone: {
    off: ['pass_rate', 'success_rate', 'epa_per_play'],
    def: ['success_rate', 'epa_per_play', 'pass_success_rate'],
  },
  two_minute: {
    off: ['pass_rate', 'success_rate'],
    def: ['pass_success_rate', 'zone_rate'],
  },
}

interface Slot {
  name: string
  required: boolean
  candidates: readonly Candidate[]
  metrics: MetricTable
}

const MATCHUP_SLOTS: readonly Slot[] = [
  { name: 'overall', required: true, candidates: [['overall', 'all']], metrics: MATCHUP_METRICS.overall },
  { name: 'early_down', required: true, candidates: [['down_dist', 'd1-long']], metrics: MATCHUP_METRICS.early_down },
  { name: 'third_short', required: true, candidates: [['down_dist', 'd3-short']], metrics: MATCHUP_METRICS.third_short },
  { name: 'third_long', required: true, candidates: [['down_dist', 'd3-long']], metrics: MATCHUP_METRICS.third_long },
  { name: 'red_zone', required: true, candidates: [['zone', 'red_zone']], metrics: MATCHUP_METRICS.red_zone },
  { name: 'two_minute', required: true, candidates: [['score_time', 'trail_1_8-two_minute']], metrics: MATCHUP_METRICS.two_minute },
]

// ---------------------------------------------------------------- derived buckets

export function distBucket(distance: number): FactSheetDerived['dist_bucket'] {
  if (distance <= 3) return 'short'
  if (distance <= 6) return 'medium'
  if (distance <= 10) return 'long'
  return 'very_long'
}

export function fieldZone(yardline100: number): FactSheetDerived['field_zone'] {
  if (yardline100 >= 90) return 'backed_up'
  if (yardline100 >= 50) return 'own_territory'
  if (yardline100 >= 21) return 'opp_territory'
  return 'red_zone'
}

export function scoreState(scoreDiff: number): FactSheetDerived['score_state'] {
  if (scoreDiff <= -9) return 'trail_9plus'
  if (scoreDiff <= -1) return 'trail_1_8'
  if (scoreDiff === 0) return 'tied'
  if (scoreDiff <= 8) return 'lead_1_8'
  return 'lead_9plus'
}

export function timeBucket(quarter: number, clockSeconds: number): FactSheetDerived['time_bucket'] {
  if ((quarter === 2 || quarter === 4) && clockSeconds <= 120) return 'two_minute'
  if (quarter === 4 || quarter === 5) return 'fourth_quarter'
  return 'normal'
}

export function derive(s: Situation): FactSheetDerived {
  return {
    down: s.down,
    dist_bucket: distBucket(s.distance),
    field_zone: fieldZone(s.yardline_100),
    score_state: scoreState(s.score_diff),
    time_bucket: timeBucket(s.quarter, s.clock_seconds),
  }
}

// ---------------------------------------------------------------- numbers

/** Round half away from zero. */
function rha(x: number): number {
  const r = Math.floor(Math.abs(x) + 0.5)
  return x < 0 ? -r : r
}

function k4(raw: number): number {
  return rha(raw * 10000)
}

export function round4(raw: number): number {
  const k = k4(raw)
  // `+ 0` normalizes -0 so it serializes as 0, like Python's int.
  return k % 10000 === 0 ? k / 10000 + 0 : k / 10000
}

export function formatValue(unit: Unit, raw: number): string {
  if (unit === 'count') return String(Math.trunc(raw))
  const k = k4(raw)
  const a = Math.abs(k)
  if (unit === 'rate') {
    const p = Math.floor((a + 50) / 100)
    return k < 0 && p > 0 ? `-${p}%` : `${p}%`
  }
  if (unit === 'epa') {
    const c = Math.floor((a + 50) / 100)
    if (c === 0) return '0.00'
    return `${k > 0 ? '+' : '-'}${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`
  }
  const t = Math.floor((a + 500) / 1000)
  return `${k < 0 && t > 0 ? '-' : ''}${Math.floor(t / 10)}.${t % 10}`
}

export function metricUnit(metric: string): Unit {
  if (EPA_METRICS.has(metric)) return 'epa'
  if (metric === 'avg_air_yards') return 'yards'
  if (metric === 'plays') return 'count'
  return 'rate'
}

// ---------------------------------------------------------------- labels

function cellLabel(row: TeamTendencyRow): string {
  if (row.grouping === 'overall') return 'all plays'
  const parts: string[] = []
  if (row.down != null && row.dist_bucket != null) parts.push(`${DOWN_LABELS[row.down]} & ${DIST_LABELS[row.dist_bucket]}`)
  if (row.field_zone != null) parts.push(ZONE_LABELS[row.field_zone])
  if (row.score_state != null) parts.push(SCORE_LABELS[row.score_state])
  if (row.time_bucket != null) parts.push(TIME_LABELS[row.time_bucket])
  return parts.join(', ')
}

function factLabel(team: string, side: Side, metric: string, row: TeamTendencyRow, season: number): string {
  const label = `${team} ${side === 'off' ? 'offense' : 'defense'}: ${METRIC_LABELS[metric]}, ${cellLabel(row)}`
  // Prior-season fallback facts name their season (SPEC §4); it is the only non-ordinal digit.
  return row.season === season ? label : `${label} (${row.season})`
}

// ---------------------------------------------------------------- context

export function normalizeContext(ctx: FactSheetContext): FactSheetContext {
  if (ctx.kind === 'situation') {
    const s = ctx.situation
    const situation = Object.fromEntries(SITUATION_KEYS.map((k) => [k, s[k]])) as unknown as Situation
    return { kind: 'situation', situation }
  }
  if (ctx.kind === 'team') return { kind: 'team', season: ctx.season, team: ctx.team }
  return { kind: 'matchup', game_id: ctx.game_id, season: ctx.season, team: ctx.team, opponent: ctx.opponent, role: ctx.role }
}

function blocks(ctx: FactSheetContext): [string, Side][] {
  if (ctx.kind === 'situation') {
    const s = ctx.situation
    const off: [string, Side] = [s.offense, 'off']
    const def: [string, Side] = [s.defense, 'def']
    return s.role === 'OC' ? [off, def] : [def, off]
  }
  if (ctx.kind === 'team') return [[ctx.team, 'off'], [ctx.team, 'def']]
  return ctx.role === 'OC'
    ? [[ctx.team, 'off'], [ctx.opponent, 'def']]
    : [[ctx.team, 'def'], [ctx.opponent, 'off']]
}

export function contextSeason(ctx: FactSheetContext): number {
  return ctx.kind === 'situation' ? ctx.situation.season : ctx.season
}

/**
 * Which tendency rows the builder needs: these teams (block order, then 'NFL') for `seasons` —
 * the context season and the prior season, used as the low-sample fallback (SPEC §4).
 * `season` is the context season.
 */
export function factSheetInputs(ctx: FactSheetContext): { season: number; seasons: number[]; teams: string[] } {
  const teams: string[] = []
  for (const [team] of blocks(ctx)) if (!teams.includes(team)) teams.push(team)
  teams.push('NFL')
  const season = contextSeason(ctx)
  return { season, seasons: [season, season - 1], teams }
}

function slots(ctx: FactSheetContext): readonly Slot[] {
  if (ctx.kind !== 'situation') return MATCHUP_SLOTS
  const d = derive(ctx.situation)
  const dd = `d${d.down}-${d.dist_bucket}`
  const ddz: Candidate = ['down_dist_zone', `${dd}-${d.field_zone}`]
  const ddst: Candidate = ['down_dist_score_time', `${dd}-${d.score_state}-${d.time_bucket}`]
  const narrow = d.field_zone === 'red_zone' || d.field_zone === 'backed_up' ? [ddz, ddst] : [ddst, ddz]
  return [
    { name: 'situational', required: true, candidates: [...narrow, ['down_dist', dd], ['overall', 'all']], metrics: SITUATION_METRICS.situational },
    { name: 'zone', required: false, candidates: [['zone', d.field_zone]], metrics: SITUATION_METRICS.zone },
    { name: 'score_time', required: false, candidates: [['score_time', `${d.score_state}-${d.time_bucket}`]], metrics: SITUATION_METRICS.score_time },
    { name: 'overall', required: true, candidates: [['overall', 'all']], metrics: SITUATION_METRICS.overall },
  ]
}

const rowKey = (season: number, team: string, side: string, grouping: string, cellKey: string) =>
  `${season}|${team}|${side}|${grouping}|${cellKey}`

function choose(
  index: Map<string, TeamTendencyRow>,
  season: number,
  team: string,
  side: Side,
  slot: Slot,
): TeamTendencyRow | null {
  // SPEC §4: each non-overall candidate is tried in the context season, then (only if not
  // low_sample) in the prior season, before moving to the next, broader candidate.
  const existing: TeamTendencyRow[] = []
  for (const [grouping, cellKey] of slot.candidates) {
    const row = index.get(rowKey(season, team, side, grouping, cellKey))
    if (row) {
      if (!row.low_sample) return row
      existing.push(row)
    }
    if (grouping !== 'overall') {
      const prior = index.get(rowKey(season - 1, team, side, grouping, cellKey))
      if (prior && !prior.low_sample) return prior
    }
  }
  return slot.required && existing.length ? existing[existing.length - 1] : null
}

export function buildFactSheet(ctx: FactSheetContext, tables: { tendencies: TeamTendencyRow[] }): FactSheet {
  const context = normalizeContext(ctx)
  const season = contextSeason(context)
  const index = new Map<string, TeamTendencyRow>()
  for (const row of tables.tendencies) {
    const key = rowKey(row.season, row.team, row.side, row.grouping, row.cell_key)
    if (!index.has(key)) index.set(key, row)
  }

  const facts: Fact[] = []
  const seen = new Set<string>()
  for (const [team, side] of blocks(context)) {
    for (const slot of slots(context)) {
      const row = choose(index, season, team, side, slot)
      if (!row) continue
      const rowSeason = row.season
      const league = index.get(rowKey(rowSeason, 'NFL', 'off', row.grouping, row.cell_key))
      const values = row as unknown as Record<string, number | null | undefined>
      const leagueValues = league as unknown as Record<string, number | null | undefined> | undefined
      for (const metric of slot.metrics[side]) {
        const raw = values[metric]
        if (raw == null) continue
        const id = `${team}.${side}.${rowSeason}.${row.grouping}.${row.cell_key}.${metric}`
        if (seen.has(id)) continue
        seen.add(id)
        const unit = metricUnit(metric)
        const leagueRaw = leagueValues?.[metric] ?? null
        facts.push({
          id,
          label: factLabel(team, side, metric, row, season),
          value: round4(raw),
          display: formatValue(unit, raw),
          unit,
          n: Math.trunc(row.plays),
          low_sample: Boolean(row.low_sample),
          league_value: leagueRaw == null ? null : round4(leagueRaw),
          league_display: leagueRaw == null ? null : formatValue(unit, leagueRaw),
        })
      }
    }
  }

  return {
    fact_sheet_version: FACT_SHEET_VERSION,
    context,
    derived: context.kind === 'situation' ? derive(context.situation) : null,
    facts: facts.slice(0, MAX_FACTS),
  }
}

/** Canonical serialization (SPEC §9); matches Python json.dumps(fs, indent=2, ensure_ascii=False). */
export function serializeFactSheet(fs: FactSheet): string {
  return JSON.stringify(fs, null, 2)
}

export function factIndex(fs: FactSheet): Map<string, Fact> {
  return new Map(fs.facts.map((f) => [f.id, f]))
}
