import { Bar, BarChart as RBarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { makeRechartsTooltip } from './ChartTooltip'
import { SrDataTable } from './DataTable'
import { ChartLegend } from './Legend'
import { ACCENT, MUTED_MARK, axisProps, defaultFormat, gridProps, seriesColor, type Formatter, type SeriesDef } from './theme'
import { cn } from '@/lib/utils'

export interface BarChartProps<T extends object> {
  data: T[]
  /** Category key. */
  xKey: keyof T & string
  series: SeriesDef[]
  /**
   * Recharts semantics: "horizontal" (default) = vertical bars, categories on the x axis;
   * "vertical" = horizontal bars, categories on the y axis (good for ranked lists / long labels).
   */
  layout?: 'horizontal' | 'vertical'
  yFormat?: Formatter
  /** Category values to paint in the team accent (single-series charts only). */
  highlight?: string[]
  referenceValue?: { value: number; label?: string }
  height?: number
  ariaLabel?: string
  className?: string
}

export function BarChart<T extends object>({
  data,
  xKey,
  series,
  layout = 'horizontal',
  yFormat = defaultFormat,
  highlight,
  referenceValue,
  height,
  ariaLabel = 'Bar chart',
  className,
}: BarChartProps<T>) {
  const vertical = layout === 'vertical'
  const colors = series.map((s, i) => s.color ?? seriesColor(i))
  const labelOf = Object.fromEntries(series.map((s) => [s.key, s.label]))
  const renderTip = makeRechartsTooltip({ format: yFormat, seriesLabel: (k) => labelOf[k] ?? k, colorFor: (k) => colors[series.findIndex((s) => s.key === k)] })
  const rows = data as Record<string, unknown>[]
  const h = height ?? (vertical ? Math.max(160, rows.length * 28 * Math.max(1, series.length * 0.75) + 40) : 260)
  const hi = highlight && series.length === 1 ? new Set(highlight) : null

  const valueAxis = <YAxis {...axisProps} type="number" tickFormatter={yFormat} width={48} />
  const catAxis = <XAxis {...axisProps} type="category" dataKey={xKey as string} interval={0} minTickGap={4} />

  return (
    <figure className={cn('min-w-0', className)} aria-label={ariaLabel}>
      <ChartLegend series={series} colors={colors} />
      <div style={{ height: h }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart data={rows} layout={layout} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} barGap={2} barCategoryGap="24%" accessibilityLayer={false}>
            <CartesianGrid {...gridProps} vertical={vertical} horizontal={!vertical} />
            {vertical ? (
              <>
                <XAxis {...axisProps} type="number" tickFormatter={yFormat} />
                <YAxis {...axisProps} type="category" dataKey={xKey as string} width={56} interval={0} />
              </>
            ) : (
              <>
                {catAxis}
                {valueAxis}
              </>
            )}
            {referenceValue && (
              <ReferenceLine
                {...(vertical ? { x: referenceValue.value } : { y: referenceValue.value })}
                stroke="var(--chart-ink-muted)"
                strokeDasharray="4 4"
                label={referenceValue.label ? { value: referenceValue.label, position: vertical ? 'top' : 'insideTopRight', fill: 'var(--chart-ink-muted)', fontSize: 11 } : undefined}
              />
            )}
            <Tooltip content={renderTip} cursor={{ fill: 'var(--muted)', opacity: 0.6 }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={colors[i]}
                radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                stroke="var(--chart-surface)"
                strokeWidth={1}
                isAnimationActive={false}
              >
                {hi && rows.map((r, j) => <Cell key={j} fill={hi.has(String(r[xKey])) ? ACCENT : MUTED_MARK} />)}
              </Bar>
            ))}
          </RBarChart>
        </ResponsiveContainer>
      </div>
      <SrDataTable
        caption={ariaLabel}
        columns={[xKey, ...series.map((s) => s.label)]}
        rows={rows.map((r) => [String(r[xKey]), ...series.map((s) => (typeof r[s.key] === 'number' ? yFormat(r[s.key] as number) : 'n/a'))])}
      />
    </figure>
  )
}
