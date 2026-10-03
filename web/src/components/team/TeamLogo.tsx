import { useState } from 'react'
import { getTeam } from '@/data/teams'
import type { Team } from '@/types/generated'
import { cn } from '@/lib/utils'
import { TEAM_BADGE_SIZE, TeamMonogram } from './TeamMonogram'

// CONTRACT_CHANGES 17: Team gains nullable logo_url / wordmark_url (hotlinked https URLs).
type TeamWithLogos = Team & { logo_url?: string | null; wordmark_url?: string | null }

/** Wordmarks are wide: same height as the logo box, 4× as wide. */
const WORDMARK_SIZE = { xs: 'h-5 w-20', sm: 'h-7 w-28', md: 'h-10 w-40', lg: 'h-14 w-56' } as const

export interface TeamLogoProps {
  team: string
  size?: keyof typeof TEAM_BADGE_SIZE
  variant?: 'logo' | 'wordmark'
  className?: string
}

/**
 * Team logo (or wordmark) in a fixed-size box, so there is no layout shift while it loads.
 * Falls back to <TeamMonogram> when the team has no URL or the image fails to load.
 * In dark mode a faint halo (.team-logo, index.css) keeps dark marks legible on dark surfaces.
 */
export function TeamLogo({ team, size = 'sm', variant = 'logo', className }: TeamLogoProps) {
  const t = getTeam(team) as TeamWithLogos | undefined
  const src = (variant === 'wordmark' ? t?.wordmark_url : t?.logo_url) ?? null
  // Remember which URL failed, so a new src (team change) gets a fresh attempt.
  const [failed, setFailed] = useState<string | null>(null)

  if (!t || !src || failed === src) {
    return <TeamMonogram team={t?.abbr ?? team} size={size} className={className} />
  }
  const box = variant === 'wordmark' ? WORDMARK_SIZE[size] : TEAM_BADGE_SIZE[size]
  return (
    <span className={cn('inline-grid shrink-0 place-items-center', box, className)}>
      <img
        src={src}
        alt={`${t.name} ${variant === 'wordmark' ? 'wordmark' : 'logo'}`}
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className="team-logo size-full object-contain"
      />
    </span>
  )
}
