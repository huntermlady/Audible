import teamsJson from '@shared/teams.json'
import type { Team } from '@/types/generated'

export const TEAMS: readonly Team[] = [...(teamsJson as Team[])].sort((a, b) => a.abbr.localeCompare(b.abbr))
const BY_ABBR = new Map(TEAMS.map((t) => [t.abbr, t]))

export function getTeam(abbr?: string | null): Team | undefined {
  return abbr ? BY_ABBR.get(abbr.toUpperCase()) : undefined
}

/** All 32 teams, sorted by abbr (static, from shared/teams.json). */
export function useTeams(): Team[] {
  return TEAMS as Team[]
}

export function useTeam(abbr?: string): Team | undefined {
  return getTeam(abbr)
}
