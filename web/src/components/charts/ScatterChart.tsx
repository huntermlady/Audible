import { useState } from 'react'
import { CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart as RScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { ChartTooltipCard } from './ChartTooltip'
import { niceScale } from './scale'
import { SrDataTable } from './DataTable'
import { ACCENT, MUTED_MARK, axisProps, defaultFormat, seriesColor, type Formatter } from './theme'
import { cn } from '@/lib/utils'

export interface ScatterChartProps<T extends object> {
  data: T[]
  xKey: keyof T & string
  yKey: keyof T & string
  /** Point label (e.g. team abbr); drawn beside each point and used in the tooltip. */
  labelKey: keyof T & string
  xLabel: string
  yLabel: string
  xFormat?: Formatter
  yFormat?: Formatter
  /** Labels to paint in the team accent; the rest become muted. */
  highlight?: string[]
  /** Per-point image URL (e.g. a team logo). null/undefined or a load error → the circle. */
  pointImage?: (row: T) => string | null | undefined
  /** Flip an axis so "better" is up/right (e.g. defensive EPA allowed). */
  reverseX?: boolean
  reverseY?: boolean
  /** Draw reference lines (e.g. league averages); default: none. */
  referenceX?: number
  referenceY?: number
  height?: number
  ariaLabel?: string
  className?: string
}

export function ScatterChart<T extends object>({
  data,
  xKey,
  yKey,
  labelKey,
  xLabel,
  yLabel,
  xFormat = defaultFormat,
  yFormat = defaultFormat,
  highlight,
  pointImage,
  reverseX,
  reverseY,
  referenceX,
  referenceY,
  height = 360,
  ariaLabel,
  className,
}: ScatterChartProps<T>) {
  const rows = (data as Record<string, unknown>[]).filter((r) => typeof r[xKey] === 'number' && typeof r[yKey] === 'number')
  const hi = highlight?.length ? new Set(highlight) : null
  const fillFor = (r: Record<string, unknown>) => (hi ? (hi.has(String(r[labelKey])) ? ACCENT : MUTED_MARK) : seriesColor(0))
  const label = ariaLabel ?? `${yLabel} vs ${xLabel}`
  // Padded (edge points and 22px images aren't clipped) and snapped to round ticks.
  const scaleFor = (key: string) => {
    const vs = rows.map((r) => r[key] as number)
    return vs.length ? niceScale(Math.min(...vs), Math.max(...vs)) : undefined
  }
  const xs = scaleFor(xKey)
  const ys = scaleFor(yKey)

  const renderTip = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: Record<string, unknown> }[] }) => {
    const r = active ? payload?.[0]?.payload : undefined
    if (!r) return null
    return (
      <ChartTooltipCard
        title={String(r[labelKey])}
        rows={[
          { label: xLabel, value: xFormat(r[xKey] as number) },
          { label: yLabel, value: yFormat(r[yKey] as number) },
        ]}
      />
    )
  }

  return (
    <figure className={cn('min-w-0', className)} aria-label={label}>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <RScatterChart margin={{ top: 12, right: 16, bottom: 28, left: 8 }} accessibilityLayer={false}>
            <CartesianGrid stroke="var(--chart-grid)" />
            <XAxis
              {...axisProps}
              type="number"
              dataKey={xKey as string}
              name={xLabel}
              tickFormatter={xFormat}
              reversed={reverseX}
              domain={xs?.domain ?? ['auto', 'auto']}
              ticks={xs?.ticks}
              allowDecimals
              label={{ value: xLabel, position: 'insideBottom', offset: -16, fill: 'var(--chart-ink-muted)', fontSize: 12 }}
            />
            <YAxis
              {...axisProps}
              type="number"
              dataKey={yKey as string}
              name={yLabel}
              tickFormatter={yFormat}
              reversed={reverseY}
              width={52}
              domain={ys?.domain ?? ['auto', 'auto']}
              ticks={ys?.ticks}
              allowDecimals
              label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--chart-ink-muted)', fontSize: 12, style: { textAnchor: 'middle' } }}
            />
            <ZAxis range={[64, 64]} />
            {referenceX !== undefined && <ReferenceLine x={referenceX} stroke="var(--chart-axis)" strokeDasharray="4 4" />}
            {referenceY !== undefined && <ReferenceLine y={referenceY} stroke="var(--chart-axis)" strokeDasharray="4 4" />}
            <Tooltip content={renderTip} cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }} />
            <Scatter
              data={rows}
              isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number; payload?: Record<string, unknown> }) => {
                const row = p.payload
                const state = !row || !hi ? 'normal' : hi.has(String(row[labelKey])) ? 'highlight' : 'muted'
                return <PointMark cx={p.cx ?? 0} cy={p.cy ?? 0} fill={row ? fillFor(row) : MUTED_MARK} image={row && pointImage ? pointImage(row as T) : null} state={state} />
              }}
            >
              <LabelList dataKey={labelKey} position="right" offset={pointImage ? 14 : 6} fill="var(--chart-ink-muted)" fontSize={10} fontFamily="var(--font-mono)" />
            </Scatter>
          </RScatterChart>
        </ResponsiveContainer>
      </div>
      <SrDataTable caption={label} columns={[labelKey, xLabel, yLabel]} rows={rows.map((r) => [String(r[labelKey]), xFormat(r[xKey] as number), yFormat(r[yKey] as number)])} />
    </figure>
  )
}

const IMAGE_SIZE = 22

/**
 * One scatter point: an image (e.g. team logo) when `image` is set and loads, else a circle.
 * Highlighted images get an accent ring; muted ones fade. Exported for tests.
 */
export function PointMark({ cx, cy, fill, image, state = 'normal' }: { cx: number; cy: number; fill: string; image?: string | null; state?: 'normal' | 'highlight' | 'muted' }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!image || failed === image) {
    return <circle cx={cx} cy={cy} r={5} fill={fill} stroke="var(--chart-surface)" strokeWidth={2} data-point="circle" />
  }
  const half = IMAGE_SIZE / 2
  return (
    <g data-point="image" data-state={state} opacity={state === 'muted' ? 0.45 : 1}>
      {state === 'highlight' && <circle cx={cx} cy={cy} r={half + 3} fill="var(--chart-surface)" stroke="var(--accent)" strokeWidth={2.5} />}
      <image
        href={image}
        x={cx - half}
        y={cy - half}
        width={IMAGE_SIZE}
        height={IMAGE_SIZE}
        preserveAspectRatio="xMidYMid meet"
        className="team-logo"
        onError={() => setFailed(image)}
      />
    </g>
  )
}
