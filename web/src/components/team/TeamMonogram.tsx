import { getTeamAccent } from '@/design/useTeamAccent'
import { useResolvedTheme } from '@/design/theme'
import { cn } from '@/lib/utils'

export const TEAM_BADGE_SIZE = { xs: 'size-5 text-[0.6rem]', sm: 'size-7 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } as const

/** Team monogram chip (fallback for <TeamLogo>). Colors come from the contrast-checked team accent. */
export function TeamMonogram({ team, size = 'sm', className }: { team: string; size?: keyof typeof TEAM_BADGE_SIZE; className?: string }) {
  const accent = getTeamAccent(team)
  const theme = useResolvedTheme()
  const pair = accent?.[theme]
  return (
    <span
      aria-hidden
      data-testid="team-monogram"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-md font-display leading-none font-bold tracking-wide',
        !pair && 'bg-muted text-foreground',
        TEAM_BADGE_SIZE[size],
        className,
      )}
      style={pair ? { backgroundColor: pair.accent, color: pair.foreground } : undefined}
    >
      {team}
    </span>
  )
}
