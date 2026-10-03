import { useLayoutEffect, useMemo, type ComponentProps, type RefObject } from 'react'
import { getTeam } from '@/data/teams'
import { cn } from '@/lib/utils'
import { accentCssVars, teamAccent, type TeamAccent } from './accent'

const cache = new Map<string, TeamAccent>()

/** Contrast-checked accent for a team (both themes), memoized. Undefined for unknown/absent teams. */
export function getTeamAccent(abbr?: string | null): TeamAccent | undefined {
  const team = getTeam(abbr)
  if (!team) return undefined
  let a = cache.get(team.abbr)
  if (!a) {
    a = teamAccent(team)
    cache.set(team.abbr, a)
  }
  return a
}

/**
 * Sets the team accent (--accent / --accent-foreground, via .team-accent + --team-accent-* vars)
 * on the document root, or on `ref.current` when given. Unknown/absent team → neutral accent.
 * Reverts on unmount or team change.
 */
export function useTeamAccent(abbr?: string, ref?: RefObject<HTMLElement | null>): TeamAccent | undefined {
  const accent = getTeamAccent(abbr)
  useLayoutEffect(() => {
    const el = ref ? ref.current : document.documentElement
    if (!el || !accent) return
    const vars = accentCssVars(accent)
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
    el.classList.add('team-accent')
    el.setAttribute('data-team', abbr?.toUpperCase() ?? '')
    return () => {
      for (const k of Object.keys(vars)) el.style.removeProperty(k)
      el.classList.remove('team-accent')
      el.removeAttribute('data-team')
    }
  }, [accent, abbr, ref])
  return accent
}

/** Component form: scopes the team accent to its subtree. */
export function TeamAccentScope({ team, className, style, ...rest }: { team?: string } & ComponentProps<'div'>) {
  const accent = getTeamAccent(team)
  const vars = useMemo(() => (accent ? accentCssVars(accent) : {}), [accent])
  return <div {...rest} data-team={team} className={cn(accent && 'team-accent', className)} style={{ ...vars, ...style }} />
}
