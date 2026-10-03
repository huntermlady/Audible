import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { ROUTE_PATHS } from '@/app/routes'
import { buttonVariants } from '@/components/ui/button'

/** 404 route, also reused for unknown teams and games. */
export default function NotFoundPage({ title = 'Flag on the play', message = 'That page doesn’t exist.' }: { title?: string; message?: string }) {
  return (
    <section aria-labelledby="page-title" className="relative mx-auto max-w-xl overflow-hidden py-16 text-center">
      <div className="pointer-events-none absolute inset-x-0 top-6 mx-auto h-24 max-w-sm bg-[repeating-linear-gradient(90deg,var(--border)_0_2px,transparent_2px_36px)] opacity-70 [mask-image:linear-gradient(90deg,transparent,black,transparent)]" aria-hidden />
      <p className="relative font-mono text-sm tracking-widest text-muted-foreground">404 · ILLEGAL PROCEDURE</p>
      <h1 id="page-title" className="relative mt-2 font-display text-5xl font-bold tracking-wide uppercase sm:text-6xl">
        {title}
      </h1>
      <p className="relative mt-3 text-muted-foreground">{message}</p>
      <div className="relative mt-8 flex flex-wrap justify-center gap-2">
        <Link to={ROUTE_PATHS.dashboard} className={buttonVariants({ variant: 'accent' })} aria-label="Back to the dashboard">
          <ArrowLeft aria-hidden /> Back to the dashboard
        </Link>
        <Link to={ROUTE_PATHS.playCaller} className={buttonVariants({ variant: 'outline' })} aria-label="Open the Play-Caller">
          Try the Play-Caller
        </Link>
      </div>
    </section>
  )
}
