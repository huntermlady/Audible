import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router'
import { ErrorBoundary } from './ErrorBoundary'
import { ChatDock } from './layout/ChatDock'
import { Footer } from './layout/Footer'
import { TopBar } from './layout/TopBar'
import { StateView } from '@/components/state/StateView'
import { Skeleton } from '@/components/ui/skeleton'
import { useManifest } from '@/data/hooks'
import { SeasonGate } from '@/data/season'

export function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading page">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

function ManifestFallback() {
  const manifest = useManifest()
  return (
    <StateView query={manifest} label="the data manifest" skeleton={<PageSkeleton />} empty="No data manifest found. Run `make mock-data` or `make data`.">
      {() => <PageSkeleton />}
    </StateView>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <TopBar />
      <div className="flex flex-1">
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:py-8">
          <ErrorBoundary resetKey={pathname}>
            <SeasonGate fallback={<ManifestFallback />}>
              <Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </SeasonGate>
          </ErrorBoundary>
        </main>
        <ChatDock />
      </div>
      <Footer />
    </div>
  )
}
