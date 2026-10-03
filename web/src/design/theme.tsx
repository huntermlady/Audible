import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useMediaQuery } from '@/lib/useMediaQuery'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** localStorage key; must match the inline no-flash script in index.html. */
export const THEME_STORAGE_KEY = 'audible.theme'
export const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark']

export function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // storage blocked (private mode, sandbox) — fall through to system
  }
  return 'system'
}

export function writeStoredPreference(p: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, p)
  } catch {
    // ignore: the preference just won't persist
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(p: ThemePreference, systemDark = systemPrefersDark()): ResolvedTheme {
  return p === 'system' ? (systemDark ? 'dark' : 'light') : p
}

export function applyTheme(p: ThemePreference, root: HTMLElement = document.documentElement): ResolvedTheme {
  const resolved = resolveTheme(p)
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  root.dataset.themePref = p
  return resolved
}

export function nextPreference(p: ThemePreference): ThemePreference {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(p) + 1) % THEME_CYCLE.length]
}

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference(p: ThemePreference): void
  cycle(): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readStoredPreference)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved = resolveTheme(preference, systemDark)

  useLayoutEffect(() => {
    applyTheme(preference)
  }, [preference, systemDark])

  const setPreference = useCallback((p: ThemePreference) => {
    writeStoredPreference(p)
    setPref(p)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, cycle: () => setPreference(nextPreference(preference)) }),
    [preference, resolved, setPreference],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

/** Resolved theme; 'light' outside a provider (e.g. isolated component tests). */
export function useResolvedTheme(): ResolvedTheme {
  return useContext(ThemeContext)?.resolved ?? 'light'
}
