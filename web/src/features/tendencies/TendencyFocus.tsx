import { useEffect, useMemo, useRef } from 'react'
import { MousePointerClick, X } from 'lucide-react'
import { Heatmap } from '@/components/charts'
import { StateView } from '@/components/state/StateView'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTendencies } from '@/data'
import type { Fact } from '@/types/generated'
import { Panel } from '@/features/shared/layout'
import { gridForStat, metricInvert, metricLabel, metricScale, parseStatId, sliceLabel } from './tendencies'

const SIDE = { off: 'offense', def: 'defense' } as const

/**
 * "Show in chart" target for stat chips: the tendency grid a cited fact comes from, with the cited
 * cell called out. Scrolls itself into view whenever the focused fact changes.
 */
export function TendencyFocus({ fact, onClear, id = 'stat-focus' }: { fact: Fact | null; onClear: () => void; id?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const stat = useMemo(() => (fact ? parseStatId(fact.id) : null), [fact])
  const query = useTendencies({ season: stat?.season ?? 0, teams: stat ? [stat.team, 'NFL'] : [], grouping: stat?.grouping })

  useEffect(() => {
    if (!fact || !ref.current) return
    ref.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    ref.current.focus({ preventScroll: true })
  }, [fact])

  const grid = useMemo(() => (stat && query.data ? gridForStat(query.data, stat) : null), [stat, query.data])

  return (
    <div ref={ref} tabIndex={-1} id={id} className="scroll-mt-20 outline-none">
      <Panel
        title="Stat in context"
        description={stat ? `${stat.team} ${SIDE[stat.side]} · ${metricLabel(stat.metric)} · ${stat.season}` : 'Click a stat chip to see the tendency cell behind it.'}
        action={
          fact && (
            <Button variant="ghost" size="sm" onClick={onClear} aria-label="Clear the selected stat">
              <X aria-hidden /> Clear
            </Button>
          )
        }
      >
        {!fact ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <MousePointerClick className="size-4 shrink-0" aria-hidden />
            Every number in a coordinator call is a stat chip. Open one and choose “Show in chart”.
          </div>
        ) : !stat ? (
          <p className="text-sm text-muted-foreground">This stat ID can’t be mapped to a tendency chart.</p>
        ) : (
          <StateView query={query} label="tendencies" skeleton={<Skeleton className="h-48" />} empty="No tendency rows for this team and season.">
            {() =>
              grid && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-accent-soft px-3 py-2 text-sm">
                    <span className="font-medium">{fact.label}</span>
                    <span className="font-mono font-semibold tabular">{fact.display}</span>
                    {fact.league_display !== null && <span className="font-mono text-xs text-muted-foreground">NFL {fact.league_display}</span>}
                    <span className="font-mono text-xs text-muted-foreground">{fact.n} plays</span>
                  </div>
                  {sliceLabel(stat) && <p className="text-xs text-muted-foreground">Showing the {sliceLabel(stat)} slice.</p>}
                  <Heatmap
                    rows={grid.rows}
                    cols={grid.cols}
                    cells={grid.cells}
                    highlight={grid.focus}
                    rowLabel={grid.rowLabel}
                    colLabel={grid.colLabel}
                    colorScale={metricScale(stat.metric)}
                    invert={metricInvert(stat.metric, stat.side)}
                    ariaLabel={`${stat.team} ${SIDE[stat.side]} ${metricLabel(stat.metric)} by ${stat.grouping.replaceAll('_', ' ')}`}
                  />
                </div>
              )
            }
          </StateView>
        )}
      </Panel>
    </div>
  )
}
