import { useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { divergingFill, sequentialFill } from './theme'

export interface HeatmapCell {
  row: string
  col: string
  /** Drives the color. null → empty cell. */
  value: number | null
  /** Pre-formatted text shown in the cell. */
  display?: string
  lowSample?: boolean
  /** Extra tooltip line, e.g. "58 plays". */
  detail?: string
}

export interface HeatmapProps {
  rows: string[]
  cols: string[]
  cells: HeatmapCell[]
  /** diverging: centered on `center` (default 0), blue = above, red = below. sequential: min → max. */
  colorScale: 'diverging' | 'sequential'
  center?: number
  /** Symmetric range for diverging (default: max |value - center|); [min, max] for sequential (default: data extent). */
  domain?: number | [number, number]
  /** Flip diverging polarity when lower is better (e.g. EPA allowed by a defense). */
  invert?: boolean
  rowLabel?: (r: string) => string
  colLabel?: (c: string) => string
  onCellClick?: (cell: HeatmapCell) => void
  /** Outlines one cell (e.g. the one a cited stat points to) and appends "(cited)" to its label. */
  highlight?: { row: string; col: string }
  ariaLabel?: string
  /** Legend end labels, e.g. ['Worse', 'Better']. */
  legend?: [string, string]
  className?: string
}

/** CSS-grid heatmap. Colors are token mixes (see theme.ts); text stays in the foreground token. */
export function Heatmap({ rows, cols, cells, colorScale, center = 0, domain, invert, rowLabel = String, colLabel = String, onCellClick, highlight, ariaLabel = 'Heatmap', legend, className }: HeatmapProps) {
  const byKey = useMemo(() => new Map(cells.map((c) => [`${c.row}\u0000${c.col}`, c])), [cells])
  const values = cells.map((c) => c.value).filter((v): v is number => v !== null && Number.isFinite(v))

  const fill = useMemo(() => {
    if (colorScale === 'diverging') {
      const span = typeof domain === 'number' ? domain : Math.max(1e-9, ...values.map((v) => Math.abs(v - center)))
      return (v: number) => divergingFill(((v - center) / span) * (invert ? -1 : 1))
    }
    const [lo, hi] = Array.isArray(domain) ? domain : [Math.min(...values), Math.max(...values)]
    return (v: number) => sequentialFill(hi === lo ? 0.5 : (v - lo) / (hi - lo))
  }, [colorScale, domain, values, center, invert])

  const legendGradient =
    colorScale === 'diverging'
      ? `linear-gradient(90deg, ${divergingFill(invert ? 1 : -1)}, var(--div-mid), ${divergingFill(invert ? -1 : 1)})`
      : `linear-gradient(90deg, ${sequentialFill(0)}, ${sequentialFill(1)})`

  return (
    <figure className={cn('min-w-0', className)} aria-label={ariaLabel}>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">{ariaLabel}</caption>
          <thead>
            <tr>
              <td />
              {cols.map((c) => (
                <th key={c} scope="col" className="px-1 pb-1 text-center font-mono font-normal whitespace-nowrap text-muted-foreground">
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th scope="row" className="pr-2 text-right font-mono font-normal whitespace-nowrap text-muted-foreground">
                  {rowLabel(r)}
                </th>
                {cols.map((c) => {
                  const cell = byKey.get(`${r}\u0000${c}`)
                  const v = cell?.value
                  const has = v !== null && v !== undefined && Number.isFinite(v)
                  const text = has ? (cell?.display ?? String(v)) : '—'
                  const cited = highlight?.row === r && highlight?.col === c
                  const label = `${rowLabel(r)}, ${colLabel(c)}: ${has ? text : 'no data'}${cell?.lowSample ? ' (low sample)' : ''}${cell?.detail ? `, ${cell.detail}` : ''}${cited ? ' (cited)' : ''}`
                  const Inner = onCellClick && has ? 'button' : 'div'
                  const body = (
                    <Inner
                      type={Inner === 'button' ? 'button' : undefined}
                      tabIndex={Inner === 'div' ? 0 : undefined}
                      aria-label={label}
                      onClick={onCellClick && has && cell ? () => onCellClick(cell) : undefined}
                      className={cn(
                        'relative flex h-9 min-w-12 w-full items-center justify-center rounded-sm font-mono tabular text-foreground',
                        !has && 'bg-muted/40 text-muted-foreground',
                        cell?.lowSample && 'heatmap-low-sample',
                        Inner === 'button' && 'cursor-pointer hover:ring-2 hover:ring-ring/60',
                        cited && 'z-10 font-semibold outline-[3px] outline-offset-1 outline-foreground outline-solid',
                      )}
                      data-cited={cited || undefined}
                      style={has ? { backgroundColor: fill(v) } : undefined}
                    >
                      {text}
                      {cell?.lowSample && (
                        <span className="absolute top-0 right-0.5 text-[0.65rem] leading-none" aria-hidden>
                          *
                        </span>
                      )}
                    </Inner>
                  )
                  return (
                    <td key={c} className="p-0">
                      {has ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{body}</TooltipTrigger>
                          <TooltipContent>
                            <div className="font-medium">
                              {rowLabel(r)} · {colLabel(c)}
                            </div>
                            <div className="font-mono">{text}</div>
                            {cell?.detail && <div className="opacity-80">{cell.detail}</div>}
                            {cell?.lowSample && <div className="opacity-80">Low sample (fewer than 20 plays)</div>}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        body
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {legend?.[0] ?? 'Low'}
          <span className="h-2 w-24 rounded-full" style={{ background: legendGradient }} aria-hidden />
          {legend?.[1] ?? 'High'}
        </span>
        {cells.some((c) => c.lowSample) && <span>* low sample (&lt; 20 plays)</span>}
      </figcaption>
    </figure>
  )
}
