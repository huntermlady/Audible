import type {
  GamePlanReport,
  PlayerSeasonRow,
  PlaycallerSample,
  ReportIndexEntry,
  ScheduleGame,
  TeamSeasonRow,
  TeamTendencyRow,
  TeamWeekRow,
} from '@/types/generated'
import { fetchJson, fetchJsonOr } from './http'
import { fetchManifest } from './manifest'
import {
  playersQuery,
  teamSeasonQuery,
  teamWeekQuery,
  tendenciesQuery,
  type PlayerParams,
  type TeamSeasonParams,
  type TeamWeekParams,
  type TendencyParams,
} from './sql'
import { runQuery } from './tables'
import { dataUrl, reportUrl } from './urls'

export { fetchManifest }

export const fetchTeamSeason = (p: TeamSeasonParams) => runQuery<TeamSeasonRow>(teamSeasonQuery(p))
export const fetchTeamWeek = (p: TeamWeekParams) => runQuery<TeamWeekRow>(teamWeekQuery(p))
export const fetchTendencies = (p: TendencyParams) => runQuery<TeamTendencyRow>(tendenciesQuery(p))
export const fetchPlayers = (p: PlayerParams) => runQuery<PlayerSeasonRow>(playersQuery(p))

export interface ScheduleParams {
  season: number
  week?: number
}

let schedulePromise: Promise<ScheduleGame[]> | null = null
async function fetchAllSchedule(): Promise<ScheduleGame[]> {
  schedulePromise ??= fetchManifest().then((m) => {
    return fetchJson<ScheduleGame[]>(dataUrl(m.files.schedule.path))
  })
  schedulePromise.catch(() => {
    schedulePromise = null
  })
  return schedulePromise
}

export function filterSchedule(games: ScheduleGame[], p: ScheduleParams): ScheduleGame[] {
  return games
    .filter((g) => g.season === p.season && (p.week === undefined || g.week === p.week))
    .sort((a, b) => a.week - b.week || a.gameday.localeCompare(b.gameday) || (a.gametime ?? '').localeCompare(b.gametime ?? '') || a.game_id.localeCompare(b.game_id))
}

export async function fetchSchedule(p: ScheduleParams): Promise<ScheduleGame[]> {
  return filterSchedule(await fetchAllSchedule(), p)
}

/** reports/index.json; a missing index (404) is an empty list. */
export const fetchReportsIndex = () => fetchJsonOr<ReportIndexEntry[]>(reportUrl('index.json'), [])

/** `path` is relative to reports/, as in ReportIndexEntry.path. */
export const fetchReport = (path: string) => fetchJson<GamePlanReport>(reportUrl(path))

/** reports/samples/playcaller.json; 404 → []. */
export const fetchPlaycallerSamples = () => fetchJsonOr<PlaycallerSample[]>(reportUrl('samples/playcaller.json'), [])

/** Test hook. */
export function resetScheduleCache(): void {
  schedulePromise = null
}
