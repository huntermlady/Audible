import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Page title block: eyebrow, display title, optional description and actions. */
export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('mb-6 space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <div className="font-mono text-xs tracking-wider text-muted-foreground uppercase">{eyebrow}</div>}
          <h1 id="page-title" className="font-display text-4xl leading-none font-bold tracking-wide uppercase sm:text-5xl">
            {title}
          </h1>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      <div className="chalk-rule" aria-hidden />
    </header>
  )
}

/** Titled content panel (the page building block). */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  id,
  bodyClassName,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  bodyClassName?: string
}) {
  return (
    <section id={id} className={cn('min-w-0 rounded-xl border bg-card text-card-foreground shadow-xs', className)} aria-label={typeof title === 'string' ? title : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-display text-lg leading-tight font-bold tracking-wide uppercase">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Small uppercase label used above groups of content. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase', className)}>{children}</div>
}
