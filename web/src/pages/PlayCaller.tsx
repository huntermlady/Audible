import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, CircleStop, Loader2, MessageSquare, RotateCcw, ShieldHalf, Swords, Timer, Zap } from 'lucide-react'
import { useCoordinator } from '@/ai/useCoordinator'
import { now } from '@/ai/providers/types'
import { useChat } from '@/app/chat-context'
import { StateView } from '@/components/state/StateView'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { usePlaycallerSamples, useSeason } from '@/data'
import type { Fact, PlaycallerSample, Situation } from '@/types/generated'
import { CallCard } from '@/features/ai-output/CallCard'
import { SampleBanner } from '@/features/ai-output/SampleBanner'
import { LiveSourceBadge, useLiveAI, useLiveLostNotice } from '@/features/ai-output/source'
import { formFromSituation, validateSituation, type SituationField, type SituationForm } from '@/features/playcaller/situation'
import { SituationFormView } from '@/features/playcaller/SituationFormView'
import { clockText, DOWN_LABEL, quarterText, shortDate } from '@/features/shared/format'
import { PageHeader, Panel } from '@/features/shared/layout'
import { TendencyFocus } from '@/features/tendencies/TendencyFocus'
import { cn } from '@/lib/utils'

const DEFAULT_SITUATION: Omit<Situation, 'season'> = {
  role: 'OC',
  offense: 'KC',
  defense: 'BAL',
  down: 3,
  distance: 7,
  yardline_100: 35,
  quarter: 4,
  clock_seconds: 130,
  score_diff: -4,
  timeouts_offense: 1,
  timeouts_defense: 2,
}

export function situationSummary(s: Situation): string {
  const score = s.score_diff === 0 ? 'tied' : s.score_diff > 0 ? `leading by ${s.score_diff}` : `trailing by ${-s.score_diff}`
  const spot = s.yardline_100 === 50 ? 'midfield' : s.yardline_100 > 50 ? `own ${100 - s.yardline_100}` : `opp ${s.yardline_100}`
  return `${s.offense} vs ${s.defense} · ${DOWN_LABEL[s.down]} & ${s.distance} at ${spot} · ${quarterText(s.quarter)} ${clockText(s.clock_seconds)} · ${score}`
}

export default function PlayCallerPage() {
  const { season } = useSeason()
  const { live, provider } = useLiveAI()
  useLiveLostNotice()
  const chat = useChat()
  const [form, setForm] = useState<SituationForm>(() => formFromSituation({ ...DEFAULT_SITUATION, season }))
  const [touched, setTouched] = useState<Set<SituationField> | 'all'>(new Set())
  const [focus, setFocus] = useState<Fact | null>(null)
  const coordinator = useCoordinator(provider)
  const { state } = coordinator

  // The season always follows the global selector.
  const { situation, errors } = useMemo(() => validateSituation({ ...form, season }), [form, season])
  const running = state.status === 'running'

  const onChange = (patch: Partial<SituationForm>) => setForm((f) => ({ ...f, ...patch }))
  const onBlur = (field: SituationField) => setTouched((t) => (t === 'all' ? t : new Set(t).add(field)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched('all')
    if (!situation || !live) return
    setFocus(null)
    coordinator.run(situation)
  }

  const roleName = form.role === 'OC' ? 'offensive' : 'defensive'

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <PageHeader
        eyebrow={`AI coordinators · ${season} tendencies`}
        title="Play-Caller"
        description="Set the situation and get a call from the AI offensive or defensive coordinator. Every number in the rationale comes from the fact sheet, never from the model."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => chat.open({ page: 'play-caller', situation: situation ?? undefined })}
            aria-label="Ask the coordinators about this situation"
          >
            <MessageSquare aria-hidden /> Ask about this situation
          </Button>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <form onSubmit={submit} noValidate aria-label="Situation" className="min-w-0">
          <Panel
            title="Situation"
            action={
              <ToggleGroup type="single" variant="outline" size="sm" value={form.role} onValueChange={(v) => v && onChange({ role: v as 'OC' | 'DC' })} aria-label="Coordinator">
                <ToggleGroupItem value="OC" aria-label="Offensive coordinator">
                  <Swords aria-hidden /> OC
                </ToggleGroupItem>
                <ToggleGroupItem value="DC" aria-label="Defensive coordinator">
                  <ShieldHalf aria-hidden /> DC
                </ToggleGroupItem>
              </ToggleGroup>
            }
          >
            <SituationFormView form={form} errors={errors} shown={touched} onChange={onChange} onBlur={onBlur} disabled={running} />
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
              {live ? (
                running ? (
                  <Button type="button" variant="destructive" onClick={coordinator.cancel} aria-label="Cancel the request">
                    <CircleStop aria-hidden /> Cancel
                  </Button>
                ) : (
                  <Button type="submit" variant="accent" aria-label={`Get the ${roleName} call`}>
                    <Zap aria-hidden /> Get the {form.role} call
                  </Button>
                )
              ) : (
                <Button type="submit" variant="accent" disabled aria-label="Live AI is off">
                  <Zap aria-hidden /> Live AI is off
                </Button>
              )}
              {!situation && touched === 'all' && <span className="text-xs text-critical">Fix the highlighted fields.</span>}
            </div>
          </Panel>
        </form>

        <div className="min-w-0 space-y-6">
          {live ? (
            <LiveResult state={state} onRetry={() => situation && coordinator.run(situation)} onShowFact={setFocus} />
          ) : (
            <SampleResult
              role={form.role}
              onShowFact={setFocus}
              onLoad={(s) => {
                setForm(formFromSituation(s))
                setTouched(new Set())
              }}
            />
          )}
          {focus && <TendencyFocus fact={focus} onClear={() => setFocus(null)} />}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- live

type CoordinatorState = ReturnType<typeof useCoordinator>['state']

function useElapsed(startedAt: number | null): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (startedAt === null) return
    const id = setInterval(() => setT(now() - startedAt), 100)
    return () => clearInterval(id)
  }, [startedAt])
  return startedAt === null ? 0 : t
}

const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)

function LiveResult({ state, onRetry, onShowFact }: { state: CoordinatorState; onRetry: () => void; onShowFact: (f: Fact) => void }) {
  const elapsed = useElapsed(state.status === 'running' ? state.startedAt : null)
  const badge = <LiveSourceBadge />
  if (state.status === 'idle') {
    return (
      <Panel title="The call" action={badge}>
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <Zap className="size-5 text-accent" aria-hidden />
          {state.cancelled ? <p>Request cancelled. Adjust the situation and try again.</p> : <p>Set the situation, then get the call.</p>}
        </div>
      </Panel>
    )
  }
  if (state.status === 'running') {
    return (
      <Panel title="The call" description={situationSummary(state.situation)} action={badge}>
        <div role="status" aria-live="polite" className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
            {state.firstTokenMs === null ? 'Building the fact sheet and waiting for the model…' : 'The coordinator is writing the call…'}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Metric label="Elapsed" value={secs(elapsed)} />
            <Metric label="First token" value={secs(state.firstTokenMs)} />
            <Metric label="Streamed" value={`${state.chars} ch`} />
          </dl>
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </Panel>
    )
  }
  if (state.status === 'error') {
    return (
      <Panel title="The call" description={situationSummary(state.situation)} action={badge}>
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>The coordinator couldn’t produce a valid call</AlertTitle>
          <AlertDescription>
            <p>
              {state.attempts > 1 ? `After ${state.attempts} attempts, the response still failed validation.` : 'The request failed.'} Nothing unverified is shown.
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 font-mono text-xs">
              {state.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
        <Button className="mt-4" variant="outline" onClick={onRetry} aria-label="Try the call again">
          <RotateCcw aria-hidden /> Try again
        </Button>
      </Panel>
    )
  }
  return (
    <Panel
      title="The call"
      description={situationSummary(state.situation)}
      action={
        <span className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
          {badge}
          <Timer className="size-3.5" aria-hidden /> {secs(state.firstTokenMs)} first token · {secs(state.latencyMs)} total
          {state.attempts > 1 && ` · ${state.attempts} attempts`}
        </span>
      }
    >
      <CallCard call={state.call} factSheet={state.factSheet} situation={state.situation} onShowFact={onShowFact} />
    </Panel>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1.5">
      <dt className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-mono text-sm tabular">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------- sample mode

function SampleResult({ role, onShowFact, onLoad }: { role: 'OC' | 'DC'; onShowFact: (f: Fact) => void; onLoad: (s: Situation) => void }) {
  const samples = usePlaycallerSamples()
  const [picked, setPicked] = useState<number | null>(null)
  return (
    <div className="space-y-4">
      <SampleBanner>
        <p>Pre-generated calls for a few situations. Live calls return automatically when a local model or the cloud AI is reachable.</p>
      </SampleBanner>
      <StateView query={samples} label="sample calls" skeleton={<Skeleton className="h-96 rounded-xl" />} empty="No sample calls are available yet.">
        {(list) => {
          // Default to the first sample for the selected coordinator.
          const byRole = list.findIndex((s) => s.call.role === role)
          const index = picked !== null && list[picked]?.call.role === role ? picked : Math.max(0, byRole)
          const sample = list[index]
          return (
            <Panel
              title="Sample call"
              description={situationSummary(sample.situation)}
            >
              <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Sample calls">
                {list.map((s, i) => (
                  <SamplePick key={i} sample={s} active={i === index} onClick={() => {
                      setPicked(i)
                      onLoad(s.situation)
                    }} />
                ))}
              </div>
              <CallCard call={sample.call} factSheet={sample.fact_sheet} situation={sample.situation} onShowFact={onShowFact} />
              <p className="mt-4 font-mono text-[0.7rem] text-muted-foreground">
                Generated {shortDate(sample.generated_at)} · {sample.model}
              </p>
            </Panel>
          )
        }}
      </StateView>
    </div>
  )
}

function SamplePick({ sample: s, active, onClick }: { sample: PlaycallerSample; active: boolean; onClick: () => void }) {
  const label = `${s.call.role} · ${s.situation.offense}–${s.situation.defense} · ${DOWN_LABEL[s.situation.down]} & ${s.situation.distance}`
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Show sample: ${label}`}
      className={cn(
        'rounded-full border px-2.5 py-1 font-mono text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-accent bg-accent-soft text-foreground',
      )}
    >
      {label}
    </button>
  )
}
