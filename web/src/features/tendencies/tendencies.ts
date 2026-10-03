// Helpers for turning team_tendencies rows into heatmap grids.
import type { HeatmapCell } from '@/components/charts'
import type { TeamTendencyRow } from '@/types/generated'
import { DIST_LABEL, DISTS, DOWN_LABEL, num, pct, SCORE_LABEL, SCORE_STATES, signed, signedPct, TIME_BUCKETS, TIME_LABEL, ZONE_LABEL, ZONES } from '@/features/shared/format'

export type Side = 'off' | 'def'
export type Grouping = TeamTendencyRow['grouping']
export type MetricKey = Exclude<
  keyof TeamTendencyRow,
  'season' | 'team' | 'side' | 'grouping' | 'down' | 'dist_bucket' | 'field_zone' | 'score_state' | 'time_bucket' | 'cell_key' | 'low_sample'
>

export interface StatRef {
  team: string
  side: Side
  season: number
  grouping: Grouping
  cellKey: string
  metric: MetricKey
}

const GROUPINGS: Grouping[] = ['overall', 'down_dist', 'down_dist_zone', 'zone', 'score_time', 'down_dist_score_time']

/** `{team}.{side}.{season}.{grouping}.{cell_key}.{metric}` → parts; null when malformed. */
export function parseStatId(id: string): StatRef | null {
  const parts = id.split('.')
  if (parts.length !== 6) return null
  const [team, side, season, grouping, cellKey, metric] = parts
  if ((side !== 'off' && side !== 'def') || !GROUPINGS.includes(grouping as Grouping) || !/^\d{4}$/.test(season)) return null
  return { team, side, season: Number(season), grouping: grouping as Grouping, cellKey, metric: metric as MetricKey }
}

type Kind = 'rate' | 'epa' | 'signedRate' | 'count' | 'yards'

const METRIC_META: Partial<Record<MetricKey, { label: string; kind: Kind }>> = {
  plays: { label: 'Plays', kind: 'count' },
  pass_rate: { label: 'Pass rate', kind: 'rate' },
  proe: { label: 'PROE', kind: 'signedRate' },
  epa_per_play: { label: 'EPA/play', kind: 'epa' },
  success_rate: { label: 'Success rate', kind: 'rate' },
  explosive_rate: { label: 'Explosive rate', kind: 'rate' },
  pass_epa: { label: 'Pass EPA', kind: 'epa' },
  run_epa: { label: 'Run EPA', kind: 'epa' },
  pass_success_rate: { label: 'Pass success rate', kind: 'rate' },
  run_success_rate: { label: 'Run success rate', kind: 'rate' },
  avg_air_yards: { label: 'Avg air yards', kind: 'yards' },
  deep_pass_rate: { label: 'Deep pass rate', kind: 'rate' },
  screen_rate: { label: 'Screen rate', kind: 'rate' },
  play_action_rate: { label: 'Play-action rate', kind: 'rate' },
  shotgun_rate: { label: 'Shotgun rate', kind: 'rate' },
  no_huddle_rate: { label: 'No-huddle rate', kind: 'rate' },
  run_left_rate: { label: 'Run left rate', kind: 'rate' },
  run_middle_rate: { label: 'Run middle rate', kind: 'rate' },
  run_right_rate: { label: 'Run right rate', kind: 'rate' },
  pass_left_rate: { label: 'Pass left rate', kind: 'rate' },
  pass_middle_rate: { label: 'Pass middle rate', kind: 'rate' },
  pass_right_rate: { label: 'Pass right rate', kind: 'rate' },
  sack_rate: { label: 'Sack rate', kind: 'rate' },
  blitz_rate: { label: 'Blitz rate', kind: 'rate' },
  pressure_rate: { label: 'Pressure rate', kind: 'rate' },
  man_rate: { label: 'Man rate', kind: 'rate' },
  zone_rate: { label: 'Zone rate', kind: 'rate' },
}

export function metricLabel(m: MetricKey): string {
  return METRIC_META[m]?.label ?? m
}

export function formatMetric(m: MetricKey, v: number | null | undefined): string | null {
  const kind = METRIC_META[m]?.kind ?? 'rate'
  if (kind === 'epa') return signed(v)
  if (kind === 'signedRate') return signedPct(v)
  if (kind === 'count') return num(v)
  if (kind === 'yards') return num(v, 1)
  return pct(v)
}

/** Diverging around 0 for EPA and PROE, sequential for plain rates. */
export function metricScale(m: MetricKey): 'diverging' | 'sequential' {
  const kind = METRIC_META[m]?.kind
  return kind === 'epa' || kind === 'signedRate' ? 'diverging' : 'sequential'
}

/** For a defense, lower EPA allowed is better, so the diverging colors flip. */
export function metricInvert(m: MetricKey, side: Side): boolean {
  return side === 'def' && METRIC_META[m]?.kind === 'epa'
}

const metricValue = (r: TeamTendencyRow, m: MetricKey): number | null => {
  const v = r[m]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function cell(row: string, col: string, r: TeamTendencyRow | undefined, m: MetricKey, league: TeamTendencyRow | undefined): HeatmapCell {
  if (!r) return { row, col, value: null }
  const v = metricValue(r, m)
  const lv = league ? formatMetric(m, metricValue(league, m)) : null
  return {
    row,
    col,
    value: v,
    display: formatMetric(m, v) ?? undefined,
    lowSample: r.low_sample,
    detail: `${r.plays} plays${lv ? ` · NFL ${lv}` : ''}`,
  }
}

export interface Grid {
  rows: string[]
  cols: string[]
  rowLabel: (r: string) => string
  colLabel: (c: string) => string
  cells: HeatmapCell[]
  /** The grid position of `focus` (a cell key), when it is in the grid. */
  focus?: { row: string; col: string }
}

const byCell = (rows: TeamTendencyRow[], team: string, side: Side, grouping: Grouping) =>
  new Map(rows.filter((r) => r.team === team && r.side === side && r.grouping === grouping).map((r) => [r.cell_key, r]))
const leagueByCell = (rows: TeamTendencyRow[], grouping: Grouping) => byCell(rows, 'NFL', 'off', grouping)

/**
 * Down × distance grid. For the narrower groupings (down_dist_zone, down_dist_score_time) `suffix`
 * picks the slice, e.g. "-red_zone" or "-trail_1_8-two_minute".
 */
export function downDistGrid(rows: TeamTendencyRow[], team: string, side: Side, metric: MetricKey, grouping: Grouping = 'down_dist', suffix = ''): Grid {
  const mine = byCell(rows, team, side, grouping)
  const league = leagueByCell(rows, grouping)
  const downs = ['1', '2', '3', '4']
  const cells = downs.flatMap((d) =>
    DISTS.map((dist) => {
      const key = `d${d}-${dist}${suffix}`
      return cell(d, dist, mine.get(key), metric, league.get(key))
    }),
  )
  return { rows: downs, cols: DISTS, rowLabel: (r) => DOWN_LABEL[Number(r)] ?? r, colLabel: (c) => DIST_LABEL[c as keyof typeof DIST_LABEL] ?? c, cells }
}

export function zoneGrid(rows: TeamTendencyRow[], team: string, side: Side, metric: MetricKey): Grid {
  const mine = byCell(rows, team, side, 'zone')
  const league = leagueByCell(rows, 'zone')
  const rowName = metricLabel(metric)
  return {
    rows: [rowName],
    cols: ZONES,
    rowLabel: String,
    colLabel: (c) => ZONE_LABEL[c as keyof typeof ZONE_LABEL] ?? c,
    cells: ZONES.map((z) => cell(rowName, z, mine.get(z), metric, league.get(z))),
  }
}

export function scoreTimeGrid(rows: TeamTendencyRow[], team: string, side: Side, metric: MetricKey): Grid {
  const mine = byCell(rows, team, side, 'score_time')
  const league = leagueByCell(rows, 'score_time')
  return {
    rows: SCORE_STATES,
    cols: TIME_BUCKETS,
    rowLabel: (r) => SCORE_LABEL[r as keyof typeof SCORE_LABEL] ?? r,
    colLabel: (c) => TIME_LABEL[c as keyof typeof TIME_LABEL] ?? c,
    cells: SCORE_STATES.flatMap((s) => TIME_BUCKETS.map((t) => cell(s, t, mine.get(`${s}-${t}`), metric, league.get(`${s}-${t}`)))),
  }
}

export function overallGrid(rows: TeamTendencyRow[], team: string, side: Side, metric: MetricKey): Grid {
  const mine = byCell(rows, team, side, 'overall').get('all')
  const league = leagueByCell(rows, 'overall').get('all')
  const rowName = metricLabel(metric)
  return {
    rows: [rowName],
    cols: [team, 'NFL'],
    rowLabel: String,
    colLabel: String,
    cells: [cell(rowName, team, mine, metric, undefined), cell(rowName, 'NFL', league, metric, undefined)],
  }
}

/** The grid that shows a cited stat in context, with the cited cell located. */
export function gridForStat(rows: TeamTendencyRow[], ref: StatRef): Grid {
  const { team, side, metric, grouping, cellKey } = ref
  switch (grouping) {
    case 'overall':
      return { ...overallGrid(rows, team, side, metric), focus: { row: metricLabel(metric), col: team } }
    case 'zone':
      return { ...zoneGrid(rows, team, side, metric), focus: { row: metricLabel(metric), col: cellKey } }
    case 'score_time': {
      const [score, time] = splitScoreTime(cellKey)
      return { ...scoreTimeGrid(rows, team, side, metric), focus: { row: score, col: time } }
    }
    default: {
      // d{down}-{dist}[-rest]
      const m = /^d(\d)-(short|medium|long|very_long)(.*)$/.exec(cellKey)
      if (!m) return downDistGrid(rows, team, side, metric)
      return { ...downDistGrid(rows, team, side, metric, grouping, m[3]), focus: { row: m[1], col: m[2] } }
    }
  }
}

/** "trail_1_8-two_minute" → ["trail_1_8", "two_minute"] (values use "_", the separator is "-"). */
function splitScoreTime(key: string): [string, string] {
  const i = key.indexOf('-')
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)]
}

/** Human description of the slice a narrow grouping shows, e.g. "Red zone" or "Trail 1–8, Two-minute". */
export function sliceLabel(ref: StatRef): string | null {
  const m = /^d\d-(?:short|medium|long|very_long)-(.*)$/.exec(ref.cellKey)
  if (!m) return null
  if (ref.grouping === 'down_dist_zone') return ZONE_LABEL[m[1] as keyof typeof ZONE_LABEL] ?? m[1]
  const [s, t] = splitScoreTime(m[1])
  return `${SCORE_LABEL[s as keyof typeof SCORE_LABEL] ?? s}, ${TIME_LABEL[t as keyof typeof TIME_LABEL] ?? t}`
}
