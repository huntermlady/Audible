import { useState } from 'react'
import { BarChart3, TriangleAlert } from 'lucide-react'
import type { Fact } from '@/types/generated'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface StatChipProps {
  /** The cited stat ID. */
  id: string
  /** The fact for `id` from the fact sheet; missing → an inert "unknown stat" chip. */
  fact: Fact | undefined
  /** "Show in chart": the page reveals the tendency cell behind the fact. */
  onShow?: (fact: Fact) => void
  className?: string
}

/**
 * A cited stat. The chip text is the fact's pre-formatted `display` value (never a model-written
 * number); clicking opens the underlying fact.
 */
export function StatChip({ id, fact, onShow, className }: StatChipProps) {
  const [open, setOpen] = useState(false)
  if (!fact) {
    return (
      <span className={cn('inline-flex items-center rounded-md border border-dashed px-1.5 py-0.5 font-mono text-xs text-muted-foreground', className)} title={id}>
        unknown stat
      </span>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${fact.label}: ${fact.display}. Show the underlying stat`}
          data-stat-id={fact.id}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-xs font-medium tabular text-foreground transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          {fact.display}
          {fact.league_display !== null && <span className="text-muted-foreground">vs {fact.league_display}</span>}
          {fact.low_sample && <TriangleAlert className="size-3 text-warning" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div>
          <p className="text-sm leading-snug font-medium">{fact.label}</p>
          <p className="mt-1 font-mono text-[0.65rem] break-all text-muted-foreground">{fact.id}</p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <dt className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">Value</dt>
            <dd className="font-mono text-base font-semibold tabular">{fact.display}</dd>
          </div>
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <dt className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">NFL</dt>
            <dd className="font-mono text-base tabular">{fact.league_display ?? 'n/a'}</dd>
          </div>
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <dt className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">Plays</dt>
            <dd className="font-mono text-base tabular">{fact.n}</dd>
          </div>
        </dl>
        {fact.low_sample && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> Low sample: fewer than 20 plays in this cell.
          </p>
        )}
        {onShow && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            aria-label={`Show ${fact.label} in the tendency chart`}
            onClick={() => {
              setOpen(false)
              onShow(fact)
            }}
          >
            <BarChart3 aria-hidden /> Show in chart
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
