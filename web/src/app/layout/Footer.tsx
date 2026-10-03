import { useManifest } from '@/data/hooks'

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function Footer() {
  const manifest = useManifest()
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          Data from{' '}
          <a href="https://github.com/nflverse" target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2 hover:text-accent">
            nflverse
          </a>
          , used under its open license. Not affiliated with the NFL or any team.
        </p>
        <p className="font-mono tabular" data-testid="stats-as-of">
          Stats as of {manifest.data ? <time dateTime={manifest.data.stats_as_of}>{formatDate(manifest.data.stats_as_of)}</time> : '—'}
          {manifest.data && <> · Upcoming: Week {manifest.data.current_week}</>}
        </p>
      </div>
    </footer>
  )
}
