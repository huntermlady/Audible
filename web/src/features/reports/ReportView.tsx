import { useMemo, useState } from 'react'
import { Clock3, FileWarning, Sparkles } from 'lucide-react'
import { factIndex } from '@/ai'
import { StateView } from '@/components/state/StateView'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useReport } from '@/data'
import type { Fact, GamePlanReport, SituationalCalls } from '@/types/generated'
import { CallCard } from '@/features/ai-output/CallCard'
import { GroundedText } from '@/features/ai-output/GroundedText'
import { StatChip } from '@/features/ai-output/StatChip'
import { shortDate } from '@/features/shared/format'
import type { ReportSlot } from './reports'

const SITUATIONS: { key: keyof SituationalCalls; label: string }[] = [
  { key: 'early_down', label: 'Early down' },
  { key: 'third_short', label: '3rd & short' },
  { key: 'third_long', label: '3rd & long' },
  { key: 'red_zone', label: 'Red zone' },
  { key: 'two_minute', label: 'Two-minute' },
]

const ROLE_NAME = { OC: 'offensive coordinator', DC: 'defensive coordinator' } as const

/** One matchup report tab: loads the report file and renders it, or an empty state. */
export function ReportSlotView({ slot, onShowFact }: { slot: ReportSlot; onShowFact: (f: Fact) => void }) {
  const report = useReport(slot.entry?.path)
  if (!slot.entry) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium text-foreground">
            No {slot.team} {slot.role} report for this game
          </p>
          <p className="mt-1">Reports are generated weekly for upcoming games. This one hasn’t been generated, or it didn’t pass validation.</p>
        </div>
      </div>
    )
  }
  return (
    <StateView query={report} label="the report" skeleton={<ReportSkeleton />}>
      {(r) =>
        r.validation_status === 'failed' ? (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">This report didn’t pass validation, so it isn’t shown.</p>
        ) : (
          <ReportView report={r} stale={slot.entry!.stale} onShowFact={onShowFact} />
        )
      }
    </StateView>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-8 w-3/4" />
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

export function ReportView({ report, stale, onShowFact }: { report: GamePlanReport; stale: boolean; onShowFact: (f: Fact) => void }) {
  const facts = useMemo(() => factIndex(report.fact_sheet), [report.fact_sheet])
  const [situation, setSituation] = useState<keyof SituationalCalls>('early_down')
  return (
    <article className="space-y-6" aria-label={`${report.team} ${ROLE_NAME[report.role]} game plan`}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="accent">
            <Sparkles aria-hidden /> {report.team} {report.role}
          </Badge>
          {stale && (
            <Badge variant="outline" className="border-warning text-foreground" aria-label={`Stale report from week ${report.week}`}>
              <Clock3 aria-hidden /> Stale · week {report.week}
            </Badge>
          )}
          <span className="font-mono text-muted-foreground">
            Generated {shortDate(report.generated_at)} · stats as of {report.stats_as_of} · {report.model}
          </span>
        </div>
        <p className="font-display text-2xl leading-tight font-bold tracking-wide sm:text-3xl">
          <GroundedText text={report.headline} factSheet={report.fact_sheet} />
        </p>
        {stale && <p className="text-xs text-muted-foreground">This report was generated for an earlier week, so newer games aren’t reflected.</p>}
      </header>

      <section aria-label="Keys to the game">
        <h3 className="mb-2 font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">Keys to the game</h3>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.keys.map((k, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-lg border bg-background p-4">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl leading-none font-bold text-accent">{i + 1}</span>
                <span className="font-medium">{k.title}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                <GroundedText text={k.detail} factSheet={report.fact_sheet} />
              </p>
              <div className="mt-auto flex flex-wrap gap-1.5">
                {k.stat_ids.map((id) => (
                  <StatChip key={id} id={id} fact={facts.get(id)} onShow={onShowFact} />
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Situational calls">
        <h3 className="mb-2 font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">Situational calls</h3>
        <Tabs value={situation} onValueChange={(v) => setSituation(v as keyof SituationalCalls)}>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList variant="line" aria-label="Situation">
              {SITUATIONS.map((s) => (
                <TabsTrigger key={s.key} value={s.key}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {SITUATIONS.map((s) => (
            <TabsContent key={s.key} value={s.key} className="rounded-lg border bg-background p-4 sm:p-5">
              <CallCard call={report.situational_calls[s.key]} factSheet={report.fact_sheet} onShowFact={onShowFact} compact />
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </article>
  )
}
