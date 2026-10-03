/**
 * Surface colors used for accent contrast math. Mirrors tokens.css (a test asserts they match).
 * Accent must clear its thresholds against every surface of its theme.
 */
export const SURFACES = {
  light: { background: '#f5f5f2', card: '#fcfcfb', muted: '#ecebe7' },
  dark: { background: '#0d0d0d', card: '#1a1a19', muted: '#262624' },
} as const

export const NEUTRAL_ACCENT = {
  light: { accent: '#3b4656', foreground: '#ffffff' },
  dark: { accent: '#c9d1dc', foreground: '#0d0d0d' },
} as const

/** Foreground candidates for text on an accent fill. */
export const ON_ACCENT = { light: '#ffffff', dark: '#0d0d0d' } as const

export const CONTRAST_UI = 3
export const CONTRAST_TEXT = 4.5
