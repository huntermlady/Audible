import { useMemo } from 'react'
import { ArrowRight, CalendarDays, FileText } from 'lucide-react'
import { Link } from 'react-router'
import { ScatterChart } from '@/components/charts'
import { StateView } from '@/components/state/StateView'
import { TeamBadge } from '@/features/shared/TeamBadge'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getTeam, useManifest, useReport, useReportsIndex, useSchedule, useSeason, useTeamSeason } from '@/data'
import type { Manifest, ReportIndexEntry, ScheduleGame, TeamSeasonRow } from '@/types/generated'
import { ROUTE_PATHS } from '@/app/routes'
import { featuredReport, visibleReports } from '@/features/reports/reports'
import { fmtEpa, gameDayText, gameTimeText, signed } from '@/features/shared/format'
import { PageHeader, Panel } from '@/features/shared/layout'
import { cn } from '@/lib/utils'

/** The week the dashboard shows: the upcoming week for the current season, else that season's last week. */
function dashboardWeek(games: ScheduleGame[], season: number, m: Manifest): number | null {
  if (season === m.current_season) return m.current_week
  const weeks = games.filter((g) => g.season === season).map((g) => g.week)
  return weeks.length ? Math.max(...weeks) : null
}

export default function DashboardPage() {
  const { season } = useSeason()
  const manifest = useManifest()
  const m = manifest.data!
  const schedule = useSchedule({ season })
  const teamSeason = useTeamSeason({ season })
  const reports = useReportsIndex()
  const week = schedule.data ? dashboardWeek(schedule.data, season, m) : null

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <PageHeader
        eyebrow={`${season} season${week ? ` · week ${week}` : ''}`}
        title="Dashboard"
        description="This week's slate, the league's best and worst units by EPA per play, and where every team sits on both sides of the ball."
      />

      <FeaturedMatchup reports={reports} manifest={m} />

      <Panel
        title={week ? `Week ${week} schedule` : 'Schedule'}
        description={season === m.current_season ? 'The upcoming week. Open a game for the matchup breakdown.' : 'The final week of the selected season.'}
      >
        <StateView
          query={schedule}
          label="the schedule"
          isEmpty={(d) => !d.some((g) => g.week === week)}
          empty="No games scheduled for this week."
          skeleton={<CardsSkeleton />}
        >
          {(games) => <ScheduleGrid games={games.filter((g) => g.week === week)} reports={reports.data ?? []} />}
        </StateView>
      </Panel>

      <StateView query={teamSeason} label="team stats" skeleton={<LeadersSkeleton />} isEmpty={(rows) => !rows.some((r) => r.team !== 'NFL')} empty="No team stats for this season yet.">
        {(rows) => <Leaders rows={rows} season={season} />}
      </StateView>
    </section>
  )
}

// ---------------------------------------------------------------- featured matchup

function FeaturedMatchup({ reports, manifest }: { reports: ReturnType<typeof useReportsIndex>; manifest: Manifest }) {
  const featured = reports.data ? featuredReport(reports.data, manifest) : null
  const report = useReport(featured?.path)
  if (reports.isPending) return <Skeleton className="h-36 rounded-xl" />
  if (reports.isError || !featured) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
        <FileText className="size-4 shrink-0" aria-hidden />
        {reports.isError ? 'Game-plan reports could not be loaded.' : 'No game-plan reports yet. They are generated weekly; check back after the next run.'}
        <Link to={ROUTE_PATHS.playCaller} className="font-medium text-foreground underline underline-offset-4">
          Try the Play-Caller
        </Link>
      </div>
    )
  }
  const to = ROUTE_PATHS.matchup(featured.season, featured.week, featured.game_id)
  const [away, home] = matchupTeams(featured)
  return (
    <Link
      to={to}
      aria-label={`Featured matchup: ${away} at ${home}. Open the game-plan reports`}
      className="group relative block overflow-hidden rounded-xl border bg-card p-5 shadow-xs transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[repeating-linear-gradient(90deg,var(--border)_0_1px,transparent_1px_28px)] opacity-60 [mask-image:linear-gradient(90deg,transparent,black)]" aria-hidden />
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <TeamBadge team={away} size="lg" />
          <span className="font-display text-2xl font-bold text-muted-foreground">@</span>
          <TeamBadge team={home} size="lg" />
        </div>
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">Featured matchup</Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {featured.season} · week {featured.week}
            </span>
            {featured.stale && <Badge variant="outline">Stale report</Badge>}
          </div>
          <p className="mt-2 font-display text-2xl leading-tight font-bold tracking-wide uppercase sm:text-3xl">
            {getTeam(away)?.nickname ?? away} at {getTeam(home)?.nickname ?? home}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {report.data && report.data.validation_status !== 'failed' ? (
              <>
                <span className="font-medium text-foreground">{featured.team} {featured.role}:</span> {report.data.headline}
              </>
            ) : report.isPending ? (
              'Loading the game plan…'
            ) : (
              'AI game plans for both coordinators.'
            )}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">
          Read the game plans <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  )
}

/** nflverse game IDs are `{season}_{week}_{away}_{home}`. */
function matchupTeams(e: Pick<ReportIndexEntry, 'game_id' | 'team' | 'opponent'>): [string, string] {
  const parts = e.game_id.split('_')
  return parts.length >= 4 ? [parts[2], parts[3]] : [e.team, e.opponent]
}

// ---------------------------------------------------------------- schedule

function CardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  )
}

function ScheduleGrid({ games, reports }: { games: ScheduleGame[]; reports: ReportIndexEntry[] }) {
  const withReports = useMemo(() => new Set(visibleReports(reports).map((r) => r.game_id)), [reports])
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {games.map((g) => (
        <li key={g.game_id}>
          <GameCard game={g} hasReport={withReports.has(g.game_id)} />
        </li>
      ))}
    </ul>
  )
}

function GameCard({ game: g, hasReport }: { game: ScheduleGame; hasReport: boolean }) {
  const final = g.home_score !== null && g.away_score !== null
  const spread =
    g.spread_line === null ? null : g.spread_line === 0 ? 'Pick’em' : g.spread_line > 0 ? `${g.home_team} -${g.spread_line}` : `${g.away_team} -${Math.abs(g.spread_line)}`
  const row = (team: string, score: number | null, won: boolean) => (
    <div className="flex items-center gap-2.5">
      <TeamBadge team={team} size="sm" />
      <span className={cn('min-w-0 flex-1 truncate text-sm', final && !won && 'text-muted-foreground', won && 'font-semibold')}>{getTeam(team)?.nickname ?? team}</span>
      {final && <span className={cn('font-mono text-base tabular', won ? 'font-semibold' : 'text-muted-foreground')}>{score}</span>}
    </div>
  )
  return (
    <Link
      to={ROUTE_PATHS.matchup(g.season, g.week, g.game_id)}
      aria-label={`${g.away_team} at ${g.home_team}, ${gameDayText(g.gameday)}${final ? `, final ${g.away_score} to ${g.home_score}` : ''}. Open matchup`}
      className="flex h-full flex-col gap-2 rounded-lg border bg-background p-3 transition-colors hover:border-accent hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2 font-mono text-[0.7rem] text-muted-foreground uppercase">
        <span className="flex items-center gap-1">
          <CalendarDays className="size-3" aria-hidden />
          {gameDayText(g.gameday)}
          {gameTimeText(g.gametime) && ` · ${gameTimeText(g.gametime)}`}
        </span>
        {final ? <span>Final</span> : hasReport ? <Badge variant="accent" className="px-1.5 py-0 text-[0.65rem]">Report</Badge> : g.game_type !== 'REG' ? <span>{g.game_type}</span> : null}
      </div>
      {row(g.away_team, g.away_score, final && g.away_score! > g.home_score!)}
      {row(g.home_team, g.home_score, final && g.home_score! > g.away_score!)}
      {!final && (spread || g.total_line !== null) && (
        <div className="mt-auto flex gap-3 border-t pt-2 font-mono text-[0.7rem] text-muted-foreground">
          {spread && <span>{spread}</span>}
          {g.total_line !== null && <span>O/U {g.total_line}</span>}
        </div>
      )}
    </Link>
  )
}

// ---------------------------------------------------------------- leaders

function LeadersSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}

type Unit = 'off' | 'def'

function Leaders({ rows, season }: { rows: TeamSeasonRow[]; season: number }) {
  const nfl = rows.find((r) => r.team === 'NFL')
  const teams = rows.filter((r) => r.team !== 'NFL')
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <UnitLeaders unit="off" teams={teams} nfl={nfl} />
        <UnitLeaders unit="def" teams={teams} nfl={nfl} />
      </div>
      <Panel
        title="League map"
        description={`${season} offensive vs defensive EPA per play. Up and right is better on both sides; the dashed lines are the NFL average.`}
      >
        <ScatterChart
          data={teams.filter((t) => t.off_epa_per_play != null && t.def_epa_per_play != null)}
          xKey="off_epa_per_play"
          yKey="def_epa_per_play"
          labelKey="team"
          pointImage={(r) => getTeam(r.team)?.logo_url}
          xLabel="Offense EPA/play"
          yLabel="Defense EPA/play allowed"
          xFormat={fmtEpa}
          yFormat={fmtEpa}
          reverseY
          referenceX={nfl?.off_epa_per_play ?? undefined}
          referenceY={nfl?.def_epa_per_play ?? undefined}
          height={420}
          ariaLabel={`${season} league map: offense EPA per play against defense EPA per play allowed`}
        />
      </Panel>
    </div>
  )
}

function UnitLeaders({ unit, teams, nfl }: { unit: Unit; teams: TeamSeasonRow[]; nfl?: TeamSeasonRow }) {
  const key = unit === 'off' ? 'off_epa_per_play' : 'def_epa_per_play'
  const ranked = teams
    .filter((t): t is TeamSeasonRow & Record<typeof key, number> => t[key] != null)
    // Offense: higher is better. Defense (EPA allowed): lower is better.
    .sort((a, b) => (unit === 'off' ? b[key] - a[key] : a[key] - b[key]))
  const span = Math.max(1e-9, ...ranked.map((t) => Math.abs(t[key] - (nfl?.[key] ?? 0))))
  const title = unit === 'off' ? 'Offenses' : 'Defenses'
  return (
    <Panel
      title={`${title} by EPA/play`}
      description={unit === 'off' ? 'EPA per play gained. Bars show the gap to the NFL average.' : 'EPA per play allowed (lower is better). Bars show the gap to the NFL average.'}
      action={nfl?.[key] != null && <span className="font-mono text-xs text-muted-foreground">NFL {signed(nfl[key])}</span>}
    >
      {ranked.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not available for this season.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <LeaderList label="Top 5" rows={ranked.slice(0, 5)} rankStart={1} metric={key} center={nfl?.[key] ?? 0} span={span} good={unit === 'off' ? 1 : -1} />
          <LeaderList
            label="Bottom 5"
            rows={ranked.slice(-5)}
            rankStart={Math.max(1, ranked.length - 4)}
            metric={key}
            center={nfl?.[key] ?? 0}
            span={span}
            good={unit === 'off' ? 1 : -1}
          />
        </div>
      )}
    </Panel>
  )
}

function LeaderList({
  label,
  rows,
  rankStart,
  metric,
  center,
  span,
  good,
}: {
  label: string
  rows: (TeamSeasonRow & Record<'off_epa_per_play' | 'def_epa_per_play', number>)[]
  rankStart: number
  metric: 'off_epa_per_play' | 'def_epa_per_play'
  center: number
  span: number
  good: 1 | -1
}) {
  return (
    <div>
      <h3 className="mb-2 font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</h3>
      <ol className="space-y-1">
        {rows.map((r, i) => {
          const delta = r[metric] - center
          const better = delta * good > 0
          const w = `${Math.min(50, (Math.abs(delta) / span) * 50)}%`
          return (
            <li key={r.team}>
              <Link
                to={ROUTE_PATHS.team(r.team)}
                aria-label={`#${rankStart + i} ${getTeam(r.team)?.name ?? r.team}: ${signed(r[metric])} EPA per play`}
                className="grid grid-cols-[1.5rem_auto_2.25rem_1fr_3.25rem] items-center gap-2 rounded-md px-1 py-1 hover:bg-muted"
              >
                <span className="font-mono text-xs text-muted-foreground tabular">{rankStart + i}</span>
                <TeamBadge team={r.team} size="xs" />
                <span className="font-mono text-xs">{r.team}</span>
                <span className="relative h-2 rounded-full bg-muted/60" aria-hidden>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span
                    className={cn('absolute inset-y-0 rounded-full', better ? 'bg-accent' : 'bg-muted-foreground/50')}
                    style={delta >= 0 ? { left: '50%', width: w } : { right: '50%', width: w }}
                  />
                </span>
                <span className="text-right font-mono text-sm tabular">{signed(r[metric])}</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
