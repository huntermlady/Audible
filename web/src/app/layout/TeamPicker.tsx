import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link, useMatch } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TeamLogo } from '@/components/team/TeamLogo'
import { useTeams } from '@/data/teams'
import type { Team } from '@/types/generated'
import { cn } from '@/lib/utils'

const DIVISIONS: Team['division'][] = ['AFC East', 'AFC North', 'AFC South', 'AFC West', 'NFC East', 'NFC North', 'NFC South', 'NFC West']

/** 32 teams by division; links to /team/:abbr. */
export function TeamGrid({ onPick }: { onPick?: () => void }) {
  const teams = useTeams()
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {DIVISIONS.map((d) => (
        <div key={d}>
          <div className="mb-1 font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">{d}</div>
          <ul className="space-y-0.5">
            {teams
              .filter((t) => t.division === d)
              .map((t) => (
                <li key={t.abbr}>
                  <Link
                    to={`/team/${t.abbr}`}
                    onClick={onPick}
                    aria-label={`${t.name} team page`}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                  >
                    <TeamLogo team={t.abbr} size="xs" />
                    <span className="truncate">{t.nickname}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function TeamPicker({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const active = useMatch('/team/:abbr')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Choose a team" className={cn(active && 'text-foreground', className)} data-active={!!active}>
          Teams <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(40rem,calc(100vw-2rem))]">
        <TeamGrid onPick={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
