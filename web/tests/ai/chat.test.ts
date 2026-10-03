import { describe, expect, it } from 'vitest'
import { buildChatSystem, chatFactSheetContext } from '@/ai'
import { SITUATION } from './helpers'

const base = { team: null, opponent: null, game_id: null, situation: null }

describe('chatFactSheetContext', () => {
  it('maps each page context', () => {
    expect(chatFactSheetContext({ ...base, page: 'play-caller', situation: SITUATION }, 2025)).toEqual({ kind: 'situation', situation: SITUATION })
    expect(chatFactSheetContext({ ...base, page: 'matchup', team: 'KC', opponent: 'BAL', game_id: '2026_04_KC_BAL' }, 2025)).toEqual({
      kind: 'matchup', game_id: '2026_04_KC_BAL', season: 2026, team: 'KC', opponent: 'BAL', role: 'OC',
    })
    expect(chatFactSheetContext({ ...base, page: 'team', team: 'KC' }, 2026)).toEqual({ kind: 'team', season: 2026, team: 'KC' })
    expect(chatFactSheetContext({ ...base, page: 'other' }, 2026)).toBeNull()
  })

  it('renders the chat system prompt', () => {
    const s = buildChatSystem({ ...base, page: 'team', team: 'KC' }, null)
    expect(s).toContain('(no facts available)')
    expect(s).not.toContain('{{')
    expect(s).not.toContain('<!--')
  })
})

describe('coordinator prompts', () => {
  it('include the role-specific principles, which contain no digits', async () => {
    const { renderPrompt } = await import('@/ai/prompts')
    const oc = renderPrompt('oc_situational', {}).system
    const dc = renderPrompt('dc_report', {}).system
    expect(oc).toContain('quarterback sneak')
    expect(dc).toContain('stop front (bear)')
    expect(renderPrompt('chat', {}).system).not.toContain('{{principles}}')
    const principles = (s: string) => s.slice(s.indexOf('Situational football principles'), s.indexOf('Call format'))
    expect(principles(oc)).not.toMatch(/\d/)
  })
})
