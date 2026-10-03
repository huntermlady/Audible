import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type {
  GamePlanReport,
  Manifest,
  PlayerSeasonRow,
  PlaycallerSample,
  ReportIndexEntry,
  ScheduleGame,
  TeamSeasonRow,
  TeamTendencyRow,
  TeamWeekRow,
} from '@/types/generated'
import {
  fetchManifest,
  fetchPlayers,
  fetchPlaycallerSamples,
  fetchReport,
  fetchReportsIndex,
  fetchSchedule,
  fetchTeamSeason,
  fetchTeamWeek,
  fetchTendencies,
  type ScheduleParams,
} from './fetchers'
import { dataKeys } from './keys'
import type { PlayerParams, TeamSeasonParams, TeamWeekParams, TendencyParams } from './sql'

export function useManifest(): UseQueryResult<Manifest> {
  return useQuery({ queryKey: dataKeys.manifest(), queryFn: fetchManifest })
}

/** Rows for the season; with `team`, that team's row plus the NFL baseline row. */
export function useTeamSeason(p: TeamSeasonParams): UseQueryResult<TeamSeasonRow[]> {
  return useQuery({ queryKey: dataKeys.teamSeason(p), queryFn: () => fetchTeamSeason(p) })
}

export function useTeamWeek(p: TeamWeekParams): UseQueryResult<TeamWeekRow[]> {
  return useQuery({ queryKey: dataKeys.teamWeek(p), queryFn: () => fetchTeamWeek(p) })
}

/** Pass 'NFL' in `teams` for the league baseline. An empty `teams` list does not fetch. */
export function useTendencies(p: TendencyParams): UseQueryResult<TeamTendencyRow[]> {
  return useQuery({ queryKey: dataKeys.tendencies(p), queryFn: () => fetchTendencies(p), enabled: p.teams.length > 0 })
}

export function usePlayers(p: PlayerParams): UseQueryResult<PlayerSeasonRow[]> {
  return useQuery({ queryKey: dataKeys.players(p), queryFn: () => fetchPlayers(p) })
}

export function useSchedule(p: ScheduleParams): UseQueryResult<ScheduleGame[]> {
  return useQuery({ queryKey: dataKeys.schedule(p), queryFn: () => fetchSchedule(p) })
}

/** 404 → []. */
export function useReportsIndex(): UseQueryResult<ReportIndexEntry[]> {
  return useQuery({ queryKey: dataKeys.reportsIndex(), queryFn: fetchReportsIndex })
}

/** Disabled until `path` is given. */
export function useReport(path?: string): UseQueryResult<GamePlanReport> {
  return useQuery({ queryKey: dataKeys.report(path), queryFn: () => fetchReport(path!), enabled: !!path })
}

/** 404 → []. */
export function usePlaycallerSamples(): UseQueryResult<PlaycallerSample[]> {
  return useQuery({ queryKey: dataKeys.playcallerSamples(), queryFn: fetchPlaycallerSamples })
}
