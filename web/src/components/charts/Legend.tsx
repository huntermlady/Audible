import type { SeriesDef } from './theme'

/** HTML legend (≥ 2 series). Text in text tokens; the swatch carries identity. */
export function ChartLegend({ series, colors }: { series: SeriesDef[]; colors: string[] }) {
  if (series.length < 2) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[i] }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  )
}
