import { CartesianGrid, Line, LineChart as RLineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { makeRechartsTooltip } from './ChartTooltip'
import { SrDataTable } from './DataTable'
import { ChartLegend } from './Legend'
import { axisProps, defaultFormat, gridProps, seriesColor, type Formatter, type SeriesDef } from './theme'
import { cn } from '@/lib/utils'

export interface LineChartProps<T extends object> {
  data: T[]
  xKey: keyof T & string
  series: SeriesDef[]
  yFormat?: Formatter
  xFormat?: (v: unknown) => string
  /** Horizontal reference line (e.g. league average). */
  referenceY?: { value: number; label?: string }
  height?: number
  /** Accessible name; also the caption of the screen-reader table. */
  ariaLabel?: string
  className?: string
}

export function LineChart<T extends object>({ data, xKey, series, yFormat = defaultFormat, xFormat, referenceY, height = 260, ariaLabel = 'Line chart', className }: LineChartProps<T>) {
  const colors = series.map((s, i) => s.color ?? seriesColor(i))
  const labelOf = Object.fromEntries(series.map((s) => [s.key, s.label]))
  const colorOf = Object.fromEntries(series.map((s, i) => [s.key, colors[i]]))
  const renderTip = makeRechartsTooltip({ format: yFormat, labelFormat: (l) => (xFormat ? xFormat(l) : String(l)), seriesLabel: (k) => labelOf[k] ?? k, colorFor: (k) => colorOf[k] })
  const rows = data as Record<string, unknown>[]
  return (
    <figure className={cn('min-w-0', className)} aria-label={ariaLabel}>
      <ChartLegend series={series} colors={colors} />
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <RLineChart data={rows} margin={{ top: 8, right: 24, bottom: 4, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey={xKey as string} {...axisProps} tickFormatter={xFormat} minTickGap={12} />
            <YAxis {...axisProps} tickFormatter={yFormat} width={48} />
            {referenceY && (
              <ReferenceLine
                y={referenceY.value}
                stroke="var(--chart-ink-muted)"
                strokeDasharray="4 4"
                label={referenceY.label ? { value: referenceY.label, position: 'insideTopRight', fill: 'var(--chart-ink-muted)', fontSize: 11 } : undefined}
              />
            )}
            <Tooltip content={renderTip} cursor={{ stroke: 'var(--chart-axis)' }} />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colors[i]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </RLineChart>
        </ResponsiveContainer>
      </div>
      <SrDataTable
        caption={ariaLabel}
        columns={[xKey, ...series.map((s) => s.label)]}
        rows={rows.map((r) => [xFormat ? xFormat(r[xKey]) : String(r[xKey]), ...series.map((s) => (typeof r[s.key] === 'number' ? yFormat(r[s.key] as number) : 'n/a'))])}
      />
    </figure>
  )
}
