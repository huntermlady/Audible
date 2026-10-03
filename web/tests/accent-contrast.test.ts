import fs from 'node:fs'
import path from 'node:path'
import teams from '@shared/teams.json'
import { contrastRatio } from '@/design/color'
import { pickAccent, teamAccent, type ThemeName } from '@/design/accent'
import { CONTRAST_TEXT, CONTRAST_UI, NEUTRAL_ACCENT, SURFACES } from '@/design/palette'
import type { Team } from '@/types/generated'

const THEMES: ThemeName[] = ['light', 'dark']
const ALL = teams as Team[]

describe('team accent contrast (all teams in shared/teams.json, both themes)', () => {
  it('has 32 teams', () => {
    expect(ALL).toHaveLength(32)
  })

  describe.each(ALL.map((t) => [t.abbr, t] as const))('%s', (_abbr, team) => {
    it.each(THEMES)('%s theme: accent ≥ 3:1 (UI) and ≥ 4.5:1 (text) vs every surface; foreground ≥ 4.5:1 on accent', (theme) => {
      const a = teamAccent(team)[theme]
      for (const surface of Object.values(SURFACES[theme])) {
        const ratio = contrastRatio(a.accent, surface)
        expect(ratio, `${team.abbr} ${theme} ${a.accent} vs ${surface}`).toBeGreaterThanOrEqual(CONTRAST_UI)
        expect(ratio, `${team.abbr} ${theme} ${a.accent} vs ${surface}`).toBeGreaterThanOrEqual(CONTRAST_TEXT)
      }
      expect(contrastRatio(a.accent, a.foreground)).toBeGreaterThanOrEqual(CONTRAST_TEXT)
    })

    it('uses a team color (not the neutral fallback) in both themes', () => {
      const a = teamAccent(team)
      expect(a.light.source).not.toBe('neutral')
      expect(a.dark.source).not.toBe('neutral')
    })
  })

  it('neutral accent passes in both themes', () => {
    for (const theme of THEMES) {
      const n = NEUTRAL_ACCENT[theme]
      for (const s of Object.values(SURFACES[theme])) expect(contrastRatio(n.accent, s)).toBeGreaterThanOrEqual(CONTRAST_TEXT)
      expect(contrastRatio(n.accent, n.foreground)).toBeGreaterThanOrEqual(CONTRAST_TEXT)
    }
  })

  it('falls back to neutral with no team', () => {
    expect(pickAccent(undefined, 'light').source).toBe('neutral')
  })

  it('keeps a team color unchanged when it already passes', () => {
    const a = pickAccent({ color_primary: '#1d3a8a', color_secondary: '#ffcc00' }, 'light')
    expect(a).toMatchObject({ accent: '#1d3a8a', source: 'primary', adjusted: false })
  })
})

describe('palette.ts mirrors tokens.css', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../src/design/tokens.css'), 'utf8')
  const block = (sel: RegExp) => css.slice(css.search(sel), css.indexOf('}', css.search(sel)))
  const varIn = (b: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(b)?.[1]?.toLowerCase()

  it.each([
    ['light', /:root,\s*\.light\s*\{/],
    ['dark', /\n\.dark\s*\{/],
  ] as const)('%s surfaces', (theme, sel) => {
    const b = block(sel)
    expect(varIn(b, 'background')).toBe(SURFACES[theme].background)
    expect(varIn(b, 'card')).toBe(SURFACES[theme].card)
    expect(varIn(b, 'muted')).toBe(SURFACES[theme].muted)
    expect(varIn(b, 'accent-neutral')).toBe(NEUTRAL_ACCENT[theme].accent)
  })
})
