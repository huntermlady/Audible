import { useCallback, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { TeamTendencyRow } from '@/types/generated'
import { cn } from '@/lib/utils'
import { divergingFill, sequentialFill } from '@/components/charts/theme'

export type FieldZone = NonNullable<TeamTendencyRow['field_zone']>

export interface FieldArrow {
  kind: 'run' | 'pass'
  dir: 'left' | 'middle' | 'right'
  /** 0..1 — drives stroke width and opacity. */
  weight: number
  /** Optional text at the arrow head, e.g. "34%". */
  label?: string
}

export interface FieldProps {
  zones?: Partial<Record<FieldZone, { value: number; label?: string }>>
  /** How zone values map to color. Default: diverging if any value < 0, else sequential. */
  zoneScale?: 'diverging' | 'sequential'
  arrows?: FieldArrow[]
  /** Ball spot as yardline_100 (yards from the opponent's end zone), 1..99. */
  ballOn?: number
  /** When set, draws the line to gain (clamped to the goal line). */
  distance?: number
  /** Makes the ball marker draggable and keyboard-adjustable. */
  onBallChange?: (yardline100: number) => void
  ariaLabel?: string
  className?: string
}

// Geometry: 10 viewBox units per yard along the field (120 yds incl. end zones). The width is
// stylized (40 yds, not 53⅓) so the field stays short enough for dashboards.
const U = 10
const W = 120 * U
const H = 400
/** Offense drives left → right: own goal line at x = 10 yds, opponent goal line at x = 110 yds. */
const xOf = (yardline100: number) => (110 - yardline100) * U

export const ZONE_RANGES: Record<FieldZone, [number, number]> = {
  backed_up: [90, 99],
  own_territory: [50, 89],
  opp_territory: [21, 49],
  red_zone: [1, 20],
}
const ZONE_NAMES: Record<FieldZone, string> = {
  backed_up: 'Backed up',
  own_territory: 'Own territory',
  opp_territory: 'Opp. territory',
  red_zone: 'Red zone',
}

export function yardlineText(y: number): string {
  if (y === 50) return 'Midfield'
  return y > 50 ? `Own ${100 - y}` : `Opp ${y}`
}

const clampYard = (y: number) => Math.min(99, Math.max(1, Math.round(y)))

/** Responsive SVG football field: zone shading, direction arrows, draggable ball spot. */
export function Field({ zones, zoneScale, arrows, ballOn, distance, onBallChange, ariaLabel = 'Football field', className }: FieldProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const uid = useId().replace(/:/g, '')
  const interactive = !!onBallChange && ballOn !== undefined

  const zoneEntries = Object.entries(zones ?? {}) as [FieldZone, { value: number; label?: string }][]
  const values = zoneEntries.map(([, z]) => z.value)
  const scale = zoneScale ?? (values.some((v) => v < 0) ? 'diverging' : 'sequential')
  const zoneFill = (v: number) => {
    if (scale === 'diverging') {
      const span = Math.max(1e-9, ...values.map(Math.abs))
      return divergingFill(v / span)
    }
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    return sequentialFill(hi === lo ? 0.6 : 0.15 + (0.85 * (v - lo)) / (hi - lo))
  }

  const yardFromClientX = useCallback((clientX: number) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return undefined
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = 0
    const x = pt.matrixTransform(ctm.inverse()).x
    return clampYard(110 - x / U)
  }, [])

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const y = yardFromClientX(e.clientX)
    if (y !== undefined && y !== ballOn) onBallChange?.(y)
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive || !dragging.current) return
    const y = yardFromClientX(e.clientX)
    if (y !== undefined && y !== ballOn) onBallChange?.(y)
  }
  const endDrag = () => {
    dragging.current = false
  }

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (!interactive || ballOn === undefined) return
    // Right/Up = toward the opponent's end zone (smaller yardline_100).
    const step: Record<string, number> = { ArrowRight: -1, ArrowUp: -1, ArrowLeft: 1, ArrowDown: 1, PageUp: -10, PageDown: 10 }
    let next: number | undefined
    if (e.key in step) next = ballOn + step[e.key]
    else if (e.key === 'Home') next = 99
    else if (e.key === 'End') next = 1
    if (next === undefined) return
    e.preventDefault()
    const y = clampYard(next)
    if (y !== ballOn) onBallChange?.(y)
  }

  const bx = ballOn !== undefined ? xOf(ballOn) : undefined
  const firstDown = ballOn !== undefined && distance ? xOf(Math.max(0, ballOn - distance)) : undefined
  const arrowOrigin = bx ?? xOf(50)
  const laneY: Record<FieldArrow['dir'], number> = { left: H * 0.22, middle: H / 2, right: H * 0.78 }

  return (
    <figure className={cn('min-w-0', className)} aria-label={ariaLabel}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={cn('block h-auto w-full touch-none select-none', interactive && 'cursor-ew-resize')}
        role="group"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <marker id={`${uid}-head-run`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--series-2)" />
          </marker>
          <marker id={`${uid}-head-pass`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--series-1)" />
          </marker>
        </defs>

        {/* Turf + end zones */}
        <rect x={0} y={0} width={W} height={H} rx={12} fill="var(--field-turf)" />
        <rect x={0} y={0} width={10 * U} height={H} rx={12} fill="var(--field-endzone)" />
        <rect x={110 * U} y={0} width={10 * U} height={H} rx={12} fill="var(--field-endzone)" />
        <text x={5 * U} y={H / 2} fill="var(--chart-ink-muted)" fontSize={34} fontFamily="var(--font-display)" fontWeight={700} textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90 ${5 * U} ${H / 2})`} letterSpacing={6}>
          OWN
        </text>
        <text x={115 * U} y={H / 2} fill="var(--chart-ink-muted)" fontSize={34} fontFamily="var(--font-display)" fontWeight={700} textAnchor="middle" dominantBaseline="middle" transform={`rotate(90 ${115 * U} ${H / 2})`} letterSpacing={6}>
          OPP
        </text>

        {/* Zone shading */}
        {zoneEntries.map(([zone, z]) => {
          const [near, far] = ZONE_RANGES[zone]
          const x0 = xOf(far + 1)
          const x1 = xOf(near - 1)
          return (
            <g key={zone}>
              <rect x={x0} y={0} width={x1 - x0} height={H} fill={zoneFill(z.value)} opacity={0.9}>
                <title>{`${ZONE_NAMES[zone]}: ${z.label ?? z.value}`}</title>
              </rect>
              <text x={(x0 + x1) / 2} y={H - 22} fill="var(--chart-ink)" fontSize={22} fontFamily="var(--font-mono)" textAnchor="middle">
                {z.label ?? String(z.value)}
              </text>
              <text x={(x0 + x1) / 2} y={H - 48} fill="var(--chart-ink-muted)" fontSize={16} fontFamily="var(--font-sans)" textAnchor="middle">
                {ZONE_NAMES[zone]}
              </text>
            </g>
          )
        })}

        {/* Yard lines, numbers, hash marks */}
        {Array.from({ length: 21 }, (_, i) => {
          const x = (10 + i * 5) * U
          const major = i % 2 === 0
          const num = i * 5 <= 50 ? i * 5 : 100 - i * 5
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={0} y2={H} stroke="var(--field-line)" strokeWidth={i === 0 || i === 20 ? 4 : major ? 2 : 1} />
              {major && i > 0 && i < 20 && (
                <>
                  <text x={x} y={58} fill="var(--field-line)" fontSize={30} fontFamily="var(--font-display)" fontWeight={700} textAnchor="middle">
                    {num}
                  </text>
                </>
              )}
            </g>
          )
        })}
        {Array.from({ length: 99 }, (_, i) => {
          const x = (11 + i) * U
          return (
            <g key={`h${i}`} stroke="var(--field-line)" strokeWidth={1}>
              <line x1={x} x2={x} y1={4} y2={16} />
              <line x1={x} x2={x} y1={H * 0.4 - 6} y2={H * 0.4 + 6} />
              <line x1={x} x2={x} y1={H * 0.6 - 6} y2={H * 0.6 + 6} />
              <line x1={x} x2={x} y1={H - 16} y2={H - 4} />
            </g>
          )
        })}

        {/* Line to gain */}
        {firstDown !== undefined && <line x1={firstDown} x2={firstDown} y1={0} y2={H} stroke="var(--warning)" strokeWidth={4} opacity={0.9} />}

        {/* Direction arrows */}
        {arrows?.map((a, i) => {
          const w = Math.max(0, Math.min(1, a.weight))
          const len = (a.kind === 'run' ? 8 : 18) * U
          const y0 = H / 2
          const y1 = laneY[a.dir]
          const x1 = Math.min(W - 20, arrowOrigin + len)
          const cx = arrowOrigin + len * 0.35
          const color = a.kind === 'run' ? 'var(--series-2)' : 'var(--series-1)'
          return (
            <g key={i} opacity={0.35 + 0.65 * w}>
              <path
                d={a.kind === 'pass' ? `M${arrowOrigin} ${y0} Q ${cx} ${y1 + (y0 - y1) * 0.1 - 40} ${x1} ${y1}` : `M${arrowOrigin} ${y0} Q ${cx} ${y0} ${x1} ${y1}`}
                fill="none"
                stroke={color}
                strokeWidth={4 + 10 * w}
                strokeLinecap="round"
                strokeDasharray={a.kind === 'pass' ? '18 10' : undefined}
                markerEnd={`url(#${uid}-head-${a.kind})`}
              >
                <title>{`${a.kind} ${a.dir}${a.label ? `: ${a.label}` : ''}`}</title>
              </path>
              {a.label && (
                <text x={x1 + 14} y={y1} fill="var(--chart-ink)" fontSize={20} fontFamily="var(--font-mono)" dominantBaseline="middle" paintOrder="stroke" stroke="var(--field-turf)" strokeWidth={5}>
                  {a.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Ball spot / line of scrimmage */}
        {bx !== undefined && ballOn !== undefined && (
          <g
            role={interactive ? 'slider' : 'img'}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? 'Ball spot' : `Ball on ${yardlineText(ballOn)}`}
            aria-valuemin={interactive ? 1 : undefined}
            aria-valuemax={interactive ? 99 : undefined}
            aria-valuenow={interactive ? ballOn : undefined}
            aria-valuetext={interactive ? `${yardlineText(ballOn)} (${ballOn} yards to the end zone)` : undefined}
            aria-orientation={interactive ? 'horizontal' : undefined}
            onKeyDown={onKeyDown}
            className="group outline-none"
          >
            <line x1={bx} x2={bx} y1={0} y2={H} stroke="var(--accent)" strokeWidth={4} />
            <ellipse cx={bx} cy={H / 2} rx={30} ry={19} fill="var(--accent)" stroke="var(--chart-surface)" strokeWidth={4} />
            <line x1={bx - 12} x2={bx + 12} y1={H / 2} y2={H / 2} stroke="var(--accent-foreground)" strokeWidth={3} />
            {[-6, 0, 6].map((d) => (
              <line key={d} x1={bx + d} x2={bx + d} y1={H / 2 - 5} y2={H / 2 + 5} stroke="var(--accent-foreground)" strokeWidth={2} />
            ))}
            {/* Visible focus ring (SVG <g> has no outline) */}
            <rect x={bx - 42} y={H / 2 - 31} width={84} height={62} rx={31} fill="none" stroke="var(--ring)" strokeWidth={4} className="opacity-0 group-focus-visible:opacity-100" />
            <text x={bx} y={H / 2 - 44} fill="var(--chart-ink)" fontSize={22} fontFamily="var(--font-mono)" textAnchor="middle" paintOrder="stroke" stroke="var(--field-turf)" strokeWidth={6}>
              {yardlineText(ballOn)}
            </text>
          </g>
        )}
      </svg>
    </figure>
  )
}
