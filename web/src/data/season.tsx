import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useManifest } from './hooks'

export interface SeasonContextValue {
  season: number
  setSeason(s: number): void
  seasons: number[]
}

const SeasonContext = createContext<SeasonContextValue | null>(null)

/** Global season selector state. Defaults to manifest.current_season; `seasons` is newest-first. */
export function SeasonProvider({ children }: { children: ReactNode }) {
  const manifest = useManifest()
  const [selected, setSelected] = useState<number | null>(null)
  const value = useMemo<SeasonContextValue | null>(() => {
    if (!manifest.data) return null
    const seasons = [...manifest.data.seasons].sort((a, b) => b - a)
    const season = selected !== null && seasons.includes(selected) ? selected : manifest.data.current_season
    return { season, seasons, setSeason: setSelected }
  }, [manifest.data, selected])
  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>
}

/** Renders `fallback` until the manifest (and so the season) is known. The layout wraps pages in this. */
export function SeasonGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return useContext(SeasonContext) ? <>{children}</> : <>{fallback}</>
}

export function useSeason(): SeasonContextValue {
  const ctx = useContext(SeasonContext)
  if (!ctx) throw new Error('useSeason must be used below <SeasonGate> (pages always are)')
  return ctx
}

/** Non-throwing variant for chrome that renders before the manifest loads. */
export function useOptionalSeason(): SeasonContextValue | null {
  return useContext(SeasonContext)
}
