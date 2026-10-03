import type { ReactNode } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { useAIStatus } from '@/ai'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

export const SAMPLE_BANNER = "Live AI runs on the owner's machine — this is a sample call."

/** Sample-mode banner (BUILD_PLAN §4.2). */
export function SampleBanner({ title = SAMPLE_BANNER, children, className }: { title?: string; children?: ReactNode; className?: string }) {
  const { status, errorHint } = useAIStatus()
  return (
    <Alert className={cn('border-dashed', className)} data-testid="sample-banner">
      <MonitorSmartphone aria-hidden />
      <AlertTitle className="line-clamp-none">{title}</AlertTitle>
      <AlertDescription>
        {children}
        {status === 'checking' && <p>Checking for a local model…</p>}
        {errorHint && <p>{errorHint}</p>}
      </AlertDescription>
    </Alert>
  )
}
