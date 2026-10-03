import { useId, type ReactNode } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Field, yardlineText } from '@/components/field'
import { TeamBadge } from '@/features/shared/TeamBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTeams } from '@/data'
import { cn } from '@/lib/utils'
import type { SituationErrors, SituationField, SituationForm } from './situation'

export interface SituationFormViewProps {
  form: SituationForm
  errors: SituationErrors
  /** Fields whose errors are shown (touched, or all after a submit attempt). */
  shown: Set<SituationField> | 'all'
  onChange(patch: Partial<SituationForm>): void
  onBlur(field: SituationField): void
  disabled?: boolean
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-xs font-medium text-critical" role="alert">
      {message}
    </p>
  )
}

function Control({ label, htmlFor, error, errorId, children, className }: { label: ReactNode; htmlFor?: string; error?: string; errorId: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </Label>
      {children}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

/** The Play-Caller situation form (BUILD_PLAN §5.3.1), with a draggable ball spot on the field. */
export function SituationFormView({ form, errors, shown, onChange, onBlur, disabled }: SituationFormViewProps) {
  const id = useId()
  const teams = useTeams()
  const err = (f: SituationField) => (shown === 'all' || shown.has(f) ? errors[f] : undefined)
  const inputProps = (f: SituationField) => ({
    id: `${id}-${f}`,
    value: form[f],
    disabled,
    'aria-invalid': !!err(f) || undefined,
    'aria-describedby': err(f) ? `${id}-${f}-err` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [f]: e.target.value }),
    onBlur: () => onBlur(f),
    className: 'font-mono tabular',
  })
  const yard = Number(form.yardline_100)
  const ballOn = Number.isInteger(yard) && yard >= 1 && yard <= 99 ? yard : undefined
  const dist = Number(form.distance)

  const teamSelect = (f: 'offense' | 'defense', label: string) => (
    <Control label={label} error={err(f)} errorId={`${id}-${f}-err`}>
      <Select value={form[f]} onValueChange={(v) => { onChange({ [f]: v }); onBlur(f) }} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={label} aria-invalid={!!err(f) || undefined} aria-describedby={err(f) ? `${id}-${f}-err` : undefined}>
          <SelectValue placeholder="Team" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {teams.map((t) => (
            <SelectItem key={t.abbr} value={t.abbr}>
              <TeamBadge team={t.abbr} size="xs" /> {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Control>
  )

  const toggle = (f: SituationField, label: string, options: { value: string; label: string }[]) => (
    <Control label={label} error={err(f)} errorId={`${id}-${f}-err`}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={form[f]}
        onValueChange={(v) => v && (onChange({ [f]: v }), onBlur(f))}
        disabled={disabled}
        aria-label={label}
        className="w-full"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} aria-label={`${label}: ${o.label}`} className="flex-1 font-mono">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Control>
  )

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        {teamSelect('offense', 'Offense')}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mb-0.5"
          disabled={disabled}
          aria-label="Swap offense and defense"
          onClick={() => onChange({ offense: form.defense, defense: form.offense })}
        >
          <ArrowLeftRight aria-hidden />
        </Button>
        {teamSelect('defense', 'Defense')}
      </div>

      <div className="space-y-2">
        <Field
          ballOn={ballOn}
          distance={Number.isInteger(dist) && dist > 0 ? dist : undefined}
          onBallChange={disabled ? undefined : (y) => onChange({ yardline_100: String(y) })}
          ariaLabel="Line of scrimmage. Drag the ball or use the arrow keys to move it"
        />
        <p className="text-center font-mono text-xs text-muted-foreground">
          {ballOn ? `Ball on the ${yardlineText(ballOn)} · ${ballOn} yds to the end zone` : 'Set the ball spot'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {toggle('down', 'Down', ['1', '2', '3', '4'].map((d) => ({ value: d, label: d })))}
        <Control label="Distance" htmlFor={`${id}-distance`} error={err('distance')} errorId={`${id}-distance-err`}>
          <Input {...inputProps('distance')} inputMode="numeric" />
        </Control>
        <Control label="Yards to end zone" htmlFor={`${id}-yardline_100`} error={err('yardline_100')} errorId={`${id}-yardline_100-err`}>
          <Input {...inputProps('yardline_100')} inputMode="numeric" />
        </Control>
        <Control label="Clock (m:ss)" htmlFor={`${id}-clock`} error={err('clock')} errorId={`${id}-clock-err`}>
          <Input {...inputProps('clock')} placeholder="2:10" />
        </Control>
      </div>

      {toggle('quarter', 'Quarter', ['1', '2', '3', '4', '5'].map((q) => ({ value: q, label: q === '5' ? 'OT' : `Q${q}` })))}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Control label="Score diff (offense)" htmlFor={`${id}-score_diff`} error={err('score_diff')} errorId={`${id}-score_diff-err`}>
          <Input {...inputProps('score_diff')} inputMode="numeric" />
        </Control>
        {toggle('timeouts_offense', 'Off. timeouts', ['0', '1', '2', '3'].map((t) => ({ value: t, label: t })))}
        {toggle('timeouts_defense', 'Def. timeouts', ['0', '1', '2', '3'].map((t) => ({ value: t, label: t })))}
      </div>
    </div>
  )
}
