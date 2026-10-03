// Report filtering rules (CONTRACTS §9, T4): failed reports are never shown; reports for an earlier
// week than the upcoming one are labeled stale.
import type { Manifest, ReportIndexEntry } from '@/types/generated'

type Upcoming = Pick<Manifest, 'current_season' | 'current_week'>

/** A report is stale when it was generated for a week before the current upcoming week. */
export function isStale(entry: Pick<ReportIndexEntry, 'season' | 'week'>, m: Upcoming): boolean {
  return entry.season < m.current_season || (entry.season === m.current_season && entry.week < m.current_week)
}

/** Drops failed reports. With `gameId`, keeps only that game's reports. */
export function visibleReports(index: ReportIndexEntry[], gameId?: string): ReportIndexEntry[] {
  return index.filter((e) => e.validation_status !== 'failed' && (gameId === undefined || e.game_id === gameId))
}

export interface ReportSlot {
  key: string
  team: string
  opponent: string
  role: 'OC' | 'DC'
  entry: (ReportIndexEntry & { stale: boolean }) | null
}

/** The four matchup tabs in fixed order (A OC, A DC, B OC, B DC), each with its visible report or null. */
export function matchupReportSlots(index: ReportIndexEntry[], gameId: string, teamA: string, teamB: string, m: Upcoming): ReportSlot[] {
  const reports = visibleReports(index, gameId)
  const order: [string, string, 'OC' | 'DC'][] = [
    [teamA, teamB, 'OC'],
    [teamA, teamB, 'DC'],
    [teamB, teamA, 'OC'],
    [teamB, teamA, 'DC'],
  ]
  return order.map(([team, opponent, role]) => {
    // Newest wins if the index holds more than one run for the same slot.
    const matches = reports.filter((e) => e.team === team && e.role === role).sort((a, b) => b.generated_at.localeCompare(a.generated_at))
    const e = matches[0]
    return { key: `${team}-${role}`, team, opponent, role, entry: e ? { ...e, stale: isStale(e, m) } : null }
  })
}

/** The report to feature: fresh before stale, newest week first, OC before DC. */
export function featuredReport(index: ReportIndexEntry[], m: Upcoming): (ReportIndexEntry & { stale: boolean }) | null {
  const reports = visibleReports(index)
  if (!reports.length) return null
  const sorted = [...reports].sort(
    (a, b) =>
      Number(isStale(a, m)) - Number(isStale(b, m)) ||
      b.season - a.season ||
      b.week - a.week ||
      (a.role === b.role ? 0 : a.role === 'OC' ? -1 : 1) ||
      b.generated_at.localeCompare(a.generated_at),
  )
  return { ...sorted[0], stale: isStale(sorted[0], m) }
}
