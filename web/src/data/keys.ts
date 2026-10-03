import type { ScheduleParams } from './fetchers'
import type { PlayerParams, TeamSeasonParams, TeamWeekParams, TendencyParams } from './sql'

/** TanStack Query keys. Params are normalized so equivalent requests share a cache entry. */
export const dataKeys = {
  all: ['audible'] as const,
  manifest: () => ['audible', 'manifest'] as const,
  teamSeason: (p: TeamSeasonParams) => ['audible', 'team_season', p.season, p.team ?? null] as const,
  teamWeek: (p: TeamWeekParams) => ['audible', 'team_week', p.season, p.team ?? null] as const,
  tendencies: (p: TendencyParams) =>
    ['audible', 'team_tendencies', p.season, [...new Set(p.teams)].sort(), p.side ?? null, p.grouping ?? null] as const,
  players: (p: PlayerParams) => ['audible', 'player_season', p.season, p.position ?? null, p.team ?? null] as const,
  schedule: (p: ScheduleParams) => ['audible', 'schedule', p.season, p.week ?? null] as const,
  reportsIndex: () => ['audible', 'reports', 'index'] as const,
  report: (path?: string) => ['audible', 'reports', 'file', path ?? null] as const,
  playcallerSamples: () => ['audible', 'reports', 'samples', 'playcaller'] as const,
}
