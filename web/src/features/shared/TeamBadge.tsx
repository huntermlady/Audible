import { TeamLogo, type TeamLogoProps } from '@/components/team/TeamLogo'

/** Decorative team logo beside a visible team name: hidden from assistive tech so the name isn't read twice. */
export function TeamBadge(props: TeamLogoProps) {
  return (
    <span aria-hidden className="inline-flex shrink-0">
      <TeamLogo {...props} />
    </span>
  )
}
