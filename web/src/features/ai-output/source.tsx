// Which engine is serving live AI (CONTRACT_CHANGES 18–20): local Ollama or the cloud Worker.
import { useEffect, useRef } from 'react'
import { Cloud, Laptop } from 'lucide-react'
import { toast } from 'sonner'
import { useAIStatus, type AIStatusValue, type Provider } from '@/ai'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type AISource = NonNullable<AIStatusValue['source']>

export interface LiveAI {
  /** A provider is connected and usable right now. */
  live: boolean
  provider: Provider | null
  source: AISource | null
  status: AIStatusValue['status']
  errorHint?: string
}

export const FALLBACK_HINT = 'Live AI is unavailable right now — showing sample calls.'

/** The live-AI view pages need: provider and source only while live. */
export function useLiveAI(): LiveAI {
  const ai = useAIStatus()
  const live = ai.status === 'live' && !!ai.provider
  return { live, provider: live ? ai.provider : null, source: live ? ai.source : null, status: ai.status, errorHint: ai.errorHint }
}

const SOURCE_META: Record<AISource, { label: string; title: string; Icon: typeof Cloud }> = {
  local: { label: 'Local model', title: 'Running on Ollama on this machine', Icon: Laptop },
  cloud: { label: 'Cloud AI', title: 'Running on the Audible cloud worker', Icon: Cloud },
}

/** "Live · Cloud AI · model" chip for result headers and the chat drawer. */
export function LiveSourceBadge({ className }: { className?: string }) {
  const { live, source, provider } = useLiveAI()
  if (!live || !source) return null
  const { label, title, Icon } = SOURCE_META[source]
  return (
    <Badge variant="outline" className={cn('gap-1 font-mono text-[0.65rem]', className)} title={title} aria-label={`Live AI: ${label}${provider?.model ? `, ${provider.model}` : ''}`}>
      <span className="size-1.5 rounded-full bg-good" aria-hidden />
      <Icon aria-hidden />
      {label}
      {provider?.model && <span className="text-muted-foreground">· {provider.model}</span>}
    </Badge>
  )
}

/**
 * Announces a mid-session fall back from live to sample mode (e.g. the cloud quota ran out) with a
 * toast. Deduped by id, so the Play-Caller and the chat drawer can both call it.
 */
export function useLiveLostNotice(): void {
  const { live, status, errorHint } = useLiveAI()
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current && !live && status !== 'checking') {
      toast(errorHint ?? FALLBACK_HINT, { id: 'audible-live-lost' })
    }
    wasLive.current = live
  }, [live, status, errorHint])
}
