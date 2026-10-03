import { lit, playersQuery, teamSeasonQuery, teamWeekQuery, tendenciesQuery } from '@/data/sql'
import { dataKeys } from '@/data/keys'
import { filterSchedule } from '@/data/fetchers'
import type { ScheduleGame } from '@/types/generated'

describe('SQL builders', () => {
  it('team_season: whole season, or team + NFL baseline', () => {
    expect(teamSeasonQuery({ season: 2025 })).toEqual({ table: 'team_season', sql: 'SELECT * FROM team_season WHERE season = 2025 ORDER BY team' })
    expect(teamSeasonQuery({ season: 2025, team: 'KC' }).sql).toBe("SELECT * FROM team_season WHERE season = 2025 AND team IN ('KC', 'NFL') ORDER BY team")
    expect(teamSeasonQuery({ season: 2025, team: 'NFL' }).sql).toContain("team IN ('NFL')")
  })

  it('team_week orders by week', () => {
    expect(teamWeekQuery({ season: 2024, team: 'BAL' }).sql).toBe("SELECT * FROM team_week WHERE season = 2024 AND team IN ('BAL') ORDER BY week, team")
  })

  it('tendencies: teams (deduped), side, grouping', () => {
    const q = tendenciesQuery({ season: 2026, teams: ['KC', 'NFL', 'KC'], side: 'def', grouping: 'down_dist' })
    expect(q.table).toBe('team_tendencies')
    expect(q.sql).toBe("SELECT * FROM team_tendencies WHERE season = 2026 AND team IN ('KC', 'NFL') AND side = 'def' AND grouping = 'down_dist' ORDER BY team, side, grouping, cell_key")
  })

  it('tendencies with no teams matches nothing', () => {
    expect(tendenciesQuery({ season: 2026, teams: [] }).sql).toContain('WHERE season = 2026 AND FALSE')
  })

  it('players: position and team filters', () => {
    expect(playersQuery({ season: 2026, position: 'QB', team: 'KC' }).sql).toBe(
      "SELECT * FROM player_season WHERE season = 2026 AND position = 'QB' AND team IN ('KC') ORDER BY player_name, player_id, team",
    )
  })

  it('rejects injection and bad numbers', () => {
    expect(() => teamSeasonQuery({ season: 2025, team: "KC' OR 1=1 --" })).toThrow()
    expect(() => tendenciesQuery({ season: 2025, teams: ['KC'], grouping: 'x; DROP' })).toThrow()
    expect(() => teamSeasonQuery({ season: 2025.5 })).toThrow()
    expect(lit("O'Brien")).toBe("'O''Brien'")
  })
})

describe('query keys', () => {
  it('normalize team order and duplicates for tendencies', () => {
    expect(dataKeys.tendencies({ season: 1, teams: ['NFL', 'KC', 'KC'] })).toEqual(dataKeys.tendencies({ season: 1, teams: ['KC', 'NFL'] }))
  })
  it('distinguish optional params', () => {
    expect(dataKeys.teamSeason({ season: 1 })).not.toEqual(dataKeys.teamSeason({ season: 1, team: 'KC' }))
  })
})

describe('filterSchedule', () => {
  const g = (id: string, season: number, week: number, gameday: string, gametime: string | null = null) =>
    ({ game_id: id, season, week, gameday, gametime }) as ScheduleGame
  const games = [g('b', 2026, 2, '2026-09-20', '13:00'), g('a', 2026, 1, '2026-09-13', '20:20'), g('c', 2026, 1, '2026-09-13', '13:00'), g('z', 2025, 1, '2025-09-10')]
  it('filters by season/week and sorts chronologically', () => {
    expect(filterSchedule(games, { season: 2026 }).map((x) => x.game_id)).toEqual(['c', 'a', 'b'])
    expect(filterSchedule(games, { season: 2026, week: 2 }).map((x) => x.game_id)).toEqual(['b'])
  })
})
