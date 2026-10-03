import { contrastRatio, hexToOklch, shiftLightness } from './color'
import { CONTRAST_TEXT, NEUTRAL_ACCENT, ON_ACCENT, SURFACES } from './palette'

export type ThemeName = 'light' | 'dark'

export interface AccentPair {
  accent: string
  foreground: string
  /** Which team color it came from, and whether it was lightened/darkened. */
  source: 'primary' | 'secondary' | 'neutral'
  adjusted: boolean
}

export interface TeamAccent {
  light: AccentPair
  dark: AccentPair
}

interface TeamColors {
  color_primary: string
  color_secondary: string
}

/** Minimum contrast of `hex` against every surface of `theme`. */
export function surfaceContrast(hex: string, theme: ThemeName): number {
  return Math.min(...Object.values(SURFACES[theme]).map((s) => contrastRatio(hex, s)))
}

function onAccent(accent: string): string {
  const a = contrastRatio(accent, ON_ACCENT.light)
  const b = contrastRatio(accent, ON_ACCENT.dark)
  return a >= b ? ON_ACCENT.light : ON_ACCENT.dark
}

/**
 * The accent is used for both UI (≥ 3:1) and text (≥ 4.5:1), so it must clear 4.5:1 against every
 * surface of the theme, and its foreground must clear 4.5:1 on it. Light themes need dark accents
 * and vice versa, so a text-safe accent always pairs with the opposite-polarity foreground.
 */
function passes(hex: string, theme: ThemeName): boolean {
  return surfaceContrast(hex, theme) >= CONTRAST_TEXT && contrastRatio(hex, onAccent(hex)) >= CONTRAST_TEXT
}

/** Walk OKLCH lightness away from the surface until it passes; null if it never does. */
function adjust(hex: string, theme: ThemeName): string | null {
  const dir = theme === 'light' ? -1 : 1
  for (let step = 1; step <= 60; step++) {
    const c = shiftLightness(hex, dir * step * 0.01)
    if (passes(c, theme)) return c
  }
  return null
}

const MIN_CHROMA = 0.04 // below this a color reads as gray/white/black — not a useful team accent

export function pickAccent(colors: TeamColors | undefined, theme: ThemeName): AccentPair {
  const neutral: AccentPair = { accent: NEUTRAL_ACCENT[theme].accent, foreground: NEUTRAL_ACCENT[theme].foreground, source: 'neutral', adjusted: false }
  if (!colors) return neutral
  const candidates = (
    [
      ['primary', colors.color_primary],
      ['secondary', colors.color_secondary],
    ] as const
  ).filter(([, hex]) => /^#?[0-9a-f]{6}$/i.test(hex))
  const chromatic = candidates.filter(([, hex]) => hexToOklch(hex)[1] >= MIN_CHROMA)
  const pool = chromatic.length ? chromatic : candidates

  // 1. a team color that passes untouched (primary first)
  for (const [source, hex] of pool) {
    if (passes(hex, theme)) return { accent: hex.toLowerCase(), foreground: onAccent(hex), source, adjusted: false }
  }
  // 2. the smallest lightness adjustment of either color
  let best: { source: 'primary' | 'secondary'; hex: string; delta: number } | null = null
  for (const [source, hex] of pool) {
    const adj = adjust(hex, theme)
    if (!adj) continue
    const delta = Math.abs(hexToOklch(adj)[0] - hexToOklch(hex)[0])
    if (!best || delta < best.delta - 0.02) best = { source, hex: adj, delta }
  }
  if (best) return { accent: best.hex, foreground: onAccent(best.hex), source: best.source, adjusted: true }
  return neutral
}

export function teamAccent(colors: TeamColors | undefined): TeamAccent {
  return { light: pickAccent(colors, 'light'), dark: pickAccent(colors, 'dark') }
}

/** CSS custom properties consumed by `.team-accent` in tokens.css. */
export function accentCssVars(a: TeamAccent): Record<string, string> {
  return {
    '--team-accent-light': a.light.accent,
    '--team-accent-fg-light': a.light.foreground,
    '--team-accent-dark': a.dark.accent,
    '--team-accent-fg-dark': a.dark.foreground,
  }
}
