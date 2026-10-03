import { useId, useState, type FormEvent } from 'react'
import { AlertTriangle, CircleDot, Loader2, RotateCcw, Settings2 } from 'lucide-react'
import { useAIStatus, type AIMode, type AISource, type AIStatus } from '@/ai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

type Status = AIStatus

const MODES: { value: AIMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Try local Ollama, then the cloud, then samples.' },
  { value: 'local', label: 'Local', hint: 'Only your local Ollama server.' },
  { value: 'cloud', label: 'Cloud', hint: 'Only the hosted live AI (free daily allowance).' },
  { value: 'off', label: 'Off', hint: 'Never call a model. Show sample calls.' },
]

const CLOUD_UNAVAILABLE = 'Cloud is unavailable in this build (no VITE_AI_CLOUD_URL).'

export function statusLabel(status: Status, source: AISource): string {
  if (status === 'live') return source === 'cloud' ? 'Live · Cloud' : source === 'local' ? 'Live · Local' : 'Live'
  if (status === 'sample') return 'Sample'
  if (status === 'checking') return 'Checking AI'
  return 'AI error'
}

function description(status: Status, source: AISource, mode: AIMode): string {
  if (status === 'live')
    return source === 'cloud'
      ? 'Connected to the hosted model. Play-Caller and chat run live.'
      : 'Connected to your local Ollama model. Play-Caller and chat run live.'
  if (status === 'sample')
    return mode === 'off' ? 'Live AI is turned off. Showing pre-generated sample calls; chat is disabled.' : 'No live model is reachable. Showing pre-generated sample calls; chat is disabled.'
  if (status === 'checking') return 'Looking for a live model…'
  return 'The AI server responded unexpectedly.'
}

const DOT: Record<Status, string> = { checking: 'bg-warning', live: 'bg-good', sample: 'bg-muted-foreground', error: 'bg-critical' }

/** Top-bar AI status (source-aware) with a settings popover: mode, local base URL + model, retry. */
export function AIStatusPill() {
  const { status, source, cloudAvailable, settings, setSettings, retry, errorHint } = useAIStatus()
  const mode = settings.mode
  const label = statusLabel(status, source)

  const [open, setOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [model, setModel] = useState(settings.model)
  const [draftMode, setDraftMode] = useState<AIMode>(mode)
  const id = useId()

  const onOpenChange = (next: boolean) => {
    if (next) {
      setBaseUrl(settings.baseUrl)
      setModel(settings.model)
      setDraftMode(mode)
    }
    setOpen(next)
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    setSettings({ mode: draftMode, baseUrl: baseUrl.trim(), model: model.trim() })
    retry()
  }

  const Icon = status === 'checking' ? Loader2 : status === 'error' ? AlertTriangle : CircleDot
  const showLocal = draftMode === 'auto' || draftMode === 'local'
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`AI status: ${label}. Open AI settings`}
          data-ai-status={status}
          data-ai-source={source ?? undefined}
          className="gap-2 rounded-full px-3"
        >
          <span className={cn('size-2 rounded-full', DOT[status], status === 'checking' && 'animate-pulse')} aria-hidden />
          <span className="hidden text-xs sm:inline">{label}</span>
          <Settings2 className="size-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex items-start gap-2" role="status" aria-live="polite">
          <Icon className={cn('mt-0.5 size-4 shrink-0', status === 'checking' && 'animate-spin', status === 'error' && 'text-critical')} aria-hidden />
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{description(status, source, mode)}</p>
            {errorHint && (
              <p className="mt-1.5 text-xs text-critical" data-testid="ai-error-hint">
                {errorHint}
              </p>
            )}
          </div>
        </div>
        <form onSubmit={save} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label id={`${id}-mode`}>Mode</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draftMode}
              onValueChange={(v) => v && setDraftMode(v as AIMode)}
              aria-labelledby={`${id}-mode`}
              className="w-full"
            >
              {MODES.map((m) => {
                const off = m.value === 'cloud' && !cloudAvailable
                return (
                  <ToggleGroupItem
                    key={m.value}
                    value={m.value}
                    disabled={off}
                    aria-label={`${m.label}: ${off ? CLOUD_UNAVAILABLE : m.hint}`}
                    title={off ? CLOUD_UNAVAILABLE : undefined}
                    className="flex-1 text-xs"
                  >
                    {m.label}
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {draftMode === 'auto' && !cloudAvailable ? 'Try local Ollama, then samples.' : MODES.find((m) => m.value === draftMode)?.hint}
            </p>
            {!cloudAvailable && <p className="text-xs text-muted-foreground">{CLOUD_UNAVAILABLE}</p>}
          </div>
          {showLocal && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-url`}>Ollama base URL</Label>
                <Input id={`${id}-url`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-model`}>Local model</Label>
                <Input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="qwen3:4b-instruct" className="font-mono text-xs" />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={retry} aria-label="Retry AI connection">
              <RotateCcw aria-hidden /> Retry
            </Button>
            <Button type="submit" size="sm" aria-label="Save AI settings and reconnect">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
