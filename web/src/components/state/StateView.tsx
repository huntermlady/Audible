import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { AlertTriangle, Inbox, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface StateViewProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'isError' | 'refetch'> & { fetchStatus?: string }
  /** Rendered when data is loaded and non-empty. */
  children: (data: T) => ReactNode
  /** Empty-state message or node. Default: "No data for this selection." */
  empty?: ReactNode
  /** Default: arrays of length 0 are empty. */
  isEmpty?: (data: T) => boolean
  /** Custom loading skeleton. Default: three bars. */
  skeleton?: ReactNode
  /** Short noun for messages, e.g. "tendencies". */
  label?: string
  className?: string
}

const defaultIsEmpty = (d: unknown) => d == null || (Array.isArray(d) && d.length === 0)

/** Loading skeleton → error + retry → empty state → children(data). */
export function StateView<T>({ query, children, empty, isEmpty = defaultIsEmpty, skeleton, label = 'data', className }: StateViewProps<T>) {
  // A disabled query (enabled: false) is pending but idle: show the empty state, not a spinner forever.
  if (query.isPending && query.fetchStatus !== 'idle') {
    return (
      <div className={className} role="status" aria-live="polite" aria-label={`Loading ${label}`}>
        {skeleton ?? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}
      </div>
    )
  }
  if (query.isError) {
    return (
      <div role="alert" className={cn('flex flex-col items-start gap-3 rounded-md border border-dashed p-4 text-sm', className)}>
        <div className="flex items-center gap-2 font-medium text-critical">
          <AlertTriangle className="size-4" aria-hidden /> Couldn&apos;t load {label}
        </div>
        {query.error instanceof Error && <p className="text-muted-foreground">{query.error.message}</p>}
        <Button size="sm" variant="outline" onClick={() => void query.refetch()} aria-label={`Retry loading ${label}`}>
          <RotateCcw aria-hidden /> Retry
        </Button>
      </div>
    )
  }
  if (query.data === undefined || isEmpty(query.data)) {
    return (
      <div className={cn('flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground', className)}>
        <Inbox className="size-4 shrink-0" aria-hidden />
        {empty ?? 'No data for this selection.'}
      </div>
    )
  }
  return <>{children(query.data)}</>
}
