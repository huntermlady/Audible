import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const NOT_AVAILABLE_TEXT = 'Not available for this season'

export interface StatProps {
  label: ReactNode
  /** null/undefined → "n/a" with a "not available for this season" tooltip. Pre-format numbers. */
  value: ReactNode | null | undefined
  /** 1 = best. */
  rank?: number | null
  /** Denominator for the rank. Default 32. */
  rankOf?: number
  /** Pre-formatted league-average value. */
  leagueValue?: ReactNode | null
  /** Optional small caption under the value. */
  caption?: ReactNode
  className?: string
}

function rankTone(rank: number, of: number): string {
  if (rank <= Math.ceil(of * 0.2)) return 'text-accent'
  if (rank > of - Math.ceil(of * 0.2)) return 'text-muted-foreground'
  return 'text-foreground'
}

/** KPI tile: label, big value, optional rank and league average. */
export function Stat({ label, value, rank, rankOf = 32, leagueValue, caption, className }: StatProps) {
  const missing = value === null || value === undefined
  return (
    <div className={cn('relative flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-4 text-card-foreground', className)}>
      <div className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        {missing ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                aria-label={`n/a: ${NOT_AVAILABLE_TEXT}`}
                className="cursor-help rounded font-display text-3xl font-semibold text-muted-foreground underline decoration-dotted decoration-1 underline-offset-4"
              >
                n/a
              </span>
            </TooltipTrigger>
            <TooltipContent>{NOT_AVAILABLE_TEXT}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="truncate font-display text-3xl leading-none font-semibold tabular">{value}</span>
        )}
        {rank != null && !missing && (
          <span className={cn('shrink-0 font-mono text-xs tabular', rankTone(rank, rankOf))} aria-label={`Rank ${rank} of ${rankOf}`}>
            #{rank}
            <span className="text-muted-foreground">/{rankOf}</span>
          </span>
        )}
      </div>
      {(leagueValue != null || caption) && (
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {leagueValue != null && (
            <span>
              NFL avg <span className="font-mono tabular text-foreground">{leagueValue}</span>
            </span>
          )}
          {caption}
        </div>
      )}
    </div>
  )
}
