/**
 * Pure SQL builders for the parquet views. Values are inlined as escaped literals (inputs are
 * app-controlled: seasons, team abbrs, enums), validated here so a bad value throws instead of
 * producing SQL.
 */

export type ParquetTable = 'team_season' | 'team_week' | 'team_tendencies' | 'player_season'

export interface BuiltQuery {
  table: ParquetTable
  sql: string
}

const IDENT = /^[A-Za-z0-9_]+$/

export function lit(v: string | number | boolean): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Invalid numeric literal: ${v}`)
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${v.replace(/'/g, "''")}'`
}

function ident(v: string): string {
  if (!IDENT.test(v)) throw new Error(`Invalid identifier value: ${v}`)
  return v
}

function build(table: ParquetTable, where: string[], orderBy: string[]): BuiltQuery {
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  return { table, sql: `SELECT * FROM ${table}${w} ORDER BY ${orderBy.join(', ')}` }
}

function seasonClause(season: number): string {
  if (!Number.isInteger(season)) throw new Error(`Invalid season: ${season}`)
  return `season = ${lit(season)}`
}

function inList(col: string, values: string[]): string {
  return `${col} IN (${values.map((v) => lit(ident(v))).join(', ')})`
}

export interface TeamSeasonParams {
  season: number
  team?: string
}
/** With a team, returns that team's row plus the NFL baseline row. */
export function teamSeasonQuery(p: TeamSeasonParams): BuiltQuery {
  const where = [seasonClause(p.season)]
  if (p.team) where.push(inList('team', p.team === 'NFL' ? ['NFL'] : [p.team, 'NFL']))
  return build('team_season', where, ['team'])
}

export interface TeamWeekParams {
  season: number
  team?: string
}
export function teamWeekQuery(p: TeamWeekParams): BuiltQuery {
  const where = [seasonClause(p.season)]
  if (p.team) where.push(inList('team', [p.team]))
  return build('team_week', where, ['week', 'team'])
}

export interface TendencyParams {
  season: number
  teams: string[]
  side?: 'off' | 'def'
  grouping?: string
}
export function tendenciesQuery(p: TendencyParams): BuiltQuery {
  const where = [seasonClause(p.season)]
  if (p.teams.length) where.push(inList('team', [...new Set(p.teams)]))
  else where.push('FALSE')
  if (p.side) where.push(`side = ${lit(ident(p.side))}`)
  if (p.grouping) where.push(`grouping = ${lit(ident(p.grouping))}`)
  return build('team_tendencies', where, ['team', 'side', 'grouping', 'cell_key'])
}

export interface PlayerParams {
  season: number
  position?: 'QB' | 'RB' | 'WR' | 'TE'
  team?: string
}
export function playersQuery(p: PlayerParams): BuiltQuery {
  const where = [seasonClause(p.season)]
  if (p.position) where.push(`position = ${lit(ident(p.position))}`)
  if (p.team) where.push(inList('team', [p.team]))
  return build('player_season', where, ['player_name', 'player_id', 'team'])
}
