import type { ReactNode } from 'react'

export interface TooltipRow {
  label: ReactNode
  value: ReactNode
  color?: string
}

/** Shared tooltip body: title + rows of swatch · label · value. Text uses text tokens, never series colors. */
export function ChartTooltipCard({ title, rows }: { title?: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {title != null && <div className="mb-1 font-medium">{title}</div>}
      <ul className="space-y-0.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            {r.color && <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} aria-hidden />}
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto pl-3 font-mono tabular">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface RechartsPayload {
  dataKey?: unknown
  name?: string | number
  value?: unknown
  color?: string
  payload?: Record<string, unknown>
}

/** Adapter for Recharts' <Tooltip content={…}/>: returns a render function (not a component). */
export function makeRechartsTooltip(opts: {
  format: (v: number) => string
  labelFormat?: (label: unknown) => ReactNode
  seriesLabel?: (key: string) => string
  colorFor?: (key: string) => string | undefined
}) {
  return function renderTooltip({ active, payload, label }: { active?: boolean; payload?: readonly RechartsPayload[]; label?: unknown }) {
    if (!active || !payload?.length) return null
    return (
      <ChartTooltipCard
        title={opts.labelFormat ? opts.labelFormat(label) : (label as ReactNode)}
        rows={payload.map((p) => {
          const key = String(typeof p.dataKey === 'function' ? (p.name ?? '') : (p.dataKey ?? p.name ?? ''))
          return {
            label: opts.seriesLabel?.(key) ?? String(p.name ?? key),
            value: typeof p.value === 'number' ? opts.format(p.value) : p.value == null ? 'n/a' : String(p.value),
            color: opts.colorFor?.(key) ?? p.color,
          }
        })}
      />
    )
  }
}
