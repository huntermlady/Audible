import { lazy, Suspense } from 'react'
import { X } from 'lucide-react'
import { useChat } from '@/app/chat-context'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useMediaQuery } from '@/lib/useMediaQuery'

const ChatDrawer = lazy(() => import('@/features/chat/ChatDrawer'))

const TITLE = 'Coordinator chat'

function Body() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Skeleton className="m-4 h-24" />}>
        <ChatDrawer />
      </Suspense>
    </ErrorBoundary>
  )
}

/**
 * Chat drawer frame (T3). Docked on the right at ≥ lg; a sheet below that. The contents are the
 * default export of @/features/chat/ChatDrawer (T4), which fills the remaining height and reads
 * `useChat()` for context.
 */
export function ChatDock() {
  const { isOpen, close } = useChat()
  const desktop = useMediaQuery('(min-width: 1024px)')

  if (desktop) {
    if (!isOpen) return null
    return (
      <aside
        id="chat-drawer"
        aria-label={TITLE}
        className="sticky top-14 flex h-[calc(100dvh-3.5rem)] w-[400px] shrink-0 flex-col border-l bg-card animate-in slide-in-from-right-4 fade-in-0"
      >
        <div className="flex h-12 items-center justify-between border-b px-4">
          <h2 className="font-display text-lg font-bold tracking-wide uppercase">{TITLE}</h2>
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close coordinator chat">
            <X aria-hidden />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <Body />
        </div>
      </aside>
    )
  }

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
      <SheetContent id="chat-drawer" side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <div className="flex h-12 items-center border-b px-4 pr-12">
          <SheetTitle className="font-display text-lg font-bold tracking-wide uppercase">{TITLE}</SheetTitle>
          <SheetDescription className="sr-only">Ask the AI coordinators about the current page.</SheetDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <Body />
        </div>
      </SheetContent>
    </Sheet>
  )
}
