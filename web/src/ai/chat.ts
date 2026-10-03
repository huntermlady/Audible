// Chat drawer helpers: which fact sheet a page context gets, and the system prompt.
import type { ChatRequest, FactSheet, FactSheetContext } from '@/types/generated'
import { renderFacts, renderPrompt } from './prompts'

type ChatContext = ChatRequest['context']

/**
 * The fact sheet context for a chat page context, or null when the page has nothing to ground on.
 * - play-caller with a situation → that situation
 * - matchup with team, opponent and game_id → matchup from `team`'s offensive view (role OC); the
 *   season comes from the game_id
 * - team page with a team → team context (the team's offense and defense)
 * - anything else → null
 */
export function chatFactSheetContext(ctx: ChatContext, season: number): FactSheetContext | null {
  if (ctx.situation) return { kind: 'situation', situation: ctx.situation }
  if (ctx.page === 'matchup' && ctx.team && ctx.opponent && ctx.game_id) {
    const gameSeason = Number(ctx.game_id.slice(0, 4))
    return {
      kind: 'matchup',
      game_id: ctx.game_id,
      season: Number.isFinite(gameSeason) ? gameSeason : season,
      team: ctx.team,
      opponent: ctx.opponent,
      role: 'OC',
    }
  }
  if (ctx.page === 'team' && ctx.team) return { kind: 'team', season, team: ctx.team }
  return null
}

export function buildChatSystem(ctx: ChatContext, fs: FactSheet | null): string {
  return renderPrompt('chat', { context: JSON.stringify(ctx, null, 2), fact_sheet: renderFacts(fs) }).system
}
