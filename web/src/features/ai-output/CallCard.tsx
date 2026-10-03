import { useMemo } from 'react'
import { ArrowRightLeft, Info } from 'lucide-react'
import { factIndex } from '@/ai'
import type { CoordinatorCall, Fact, FactSheet, Situation } from '@/types/generated'
import { Badge } from '@/components/ui/badge'
import { callTitle } from '@/features/shared/format'
import { cn } from '@/lib/utils'
import { GroundedText } from './GroundedText'
import { StatChip } from './StatChip'

const CONFIDENCE_LEVEL = { low: 1, medium: 2, high: 3 } as const

export function ConfidenceMeter({ value }: { value: CoordinatorCall['confidence'] }) {
  const level = CONFIDENCE_LEVEL[value]
  return (
    <div className="flex items-center gap-2" aria-label={`Confidence: ${value}`} role="img">
      <div className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('h-3 w-2 rounded-[2px]', i <= level ? 'bg-accent' : 'bg-muted')} />
        ))}
      </div>
      <span className="text-xs font-medium text-muted-foreground capitalize">{value} confidence</span>
    </div>
  )
}

export interface CallCardProps {
  call: CoordinatorCall
  factSheet: FactSheet
  situation?: Situation | null
  onShowFact?: (fact: Fact) => void
  /** Smaller type, for the five situational calls in a report. */
  compact?: boolean
  className?: string
}

/** A coordinator call: primary call, alternatives, rationale with stat chips, confidence, caveats. */
export function CallCard({ call, factSheet, situation, onShowFact, compact, className }: CallCardProps) {
  const facts = useMemo(() => factIndex(factSheet), [factSheet])
  const p = call.primary
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="accent">{call.role === 'OC' ? 'Offensive call' : 'Defensive call'}</Badge>
          </div>
          <p className={cn('mt-2 font-display leading-none font-bold tracking-wide uppercase', compact ? 'text-2xl' : 'text-3xl sm:text-4xl')}>{callTitle(p)}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            <GroundedText text={p.concept} factSheet={factSheet} situation={situation} />
          </p>
        </div>
        <ConfidenceMeter value={call.confidence} />
      </div>

      <div>
        <h3 className="mb-2 font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">Why</h3>
        <ol className="space-y-2.5">
          {call.rationale.map((r, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="mt-0.5 font-mono text-xs text-muted-foreground tabular" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 space-y-1.5">
                <p className="leading-snug">
                  <GroundedText text={r.text} factSheet={factSheet} situation={situation} />
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {r.stat_ids.map((id) => (
                    <StatChip key={id} id={id} fact={facts.get(id)} onShow={onShowFact} />
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {call.alternatives.length > 0 && (
        <div>
          <h3 className="mb-2 font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">Alternatives</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {call.alternatives.map((a, i) => (
              <li key={i} className="rounded-lg border border-dashed p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium">
                  <ArrowRightLeft className="size-3.5 text-muted-foreground" aria-hidden />
                  {callTitle(a)}
                </div>
                <p className="mt-1 text-muted-foreground">
                  <GroundedText text={a.concept} factSheet={factSheet} situation={situation} />
                </p>
                <p className="mt-1 text-xs">
                  <span className="font-medium">When: </span>
                  <GroundedText text={a.when} factSheet={factSheet} situation={situation} />
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {call.caveats.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground" aria-label="Caveats">
          {call.caveats.map((c, i) => (
            <li key={i} className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <GroundedText text={c} factSheet={factSheet} situation={situation} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
