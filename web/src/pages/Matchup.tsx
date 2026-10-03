import { useMemo, useState } from 'react'
import { CalendarDays, MessageSquare } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useChat } from '@/app/chat-context'
import { ROUTE_PATHS } from '@/app/routes'
import { BarChart } from '@/components/charts'
import { StateView } from '@/components/state/StateView'
import { TeamBadge } from '@/features/shared/TeamBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getTeam, useManifest, useReportsIndex, useSchedule, useTeamSeason } from '@/data'
import type { Fact, ScheduleGame, TeamSeasonRow } from '@/types/generated'
import { matchupReportSlots } from '@/features/reports/reports'
import { ReportSlotView } from '@/features/reports/ReportView'
import { fmtPct, gameDayText, gameTimeText, pct, signed, signedPct } from '@/features/shared/format'
import { Panel } from '@/features/shared/layout'
import { TendencyFocus } from '@/features/tendencies/TendencyFocus'
import { cn } from '@/lib/utils'
import NotFoundPage from './NotFound'

export default function MatchupPage() {
  const params = useParams()
  const season = Number(params.season)
  const week = Number(params.week)
  const gameId = params.gameId ?? ''
  const valid = Number.isInteger(season) && Number.isInteger(week)
  const schedule = useSchedule({ season: valid ? season : 0, week: valid ? week : undefined })

  if (!valid) return <NotFoundPage title="Unknown game" message="That matchup link is malformed." />
  return (
    <StateView query={schedule} label="the schedule" skeleton={<MatchupSkeleton />} isEmpty={() => false}>
      {(games) => {
        const game = games.find((g) => g.game_id === gameId)
        return game ? <MatchupView key={gameId} game={game} /> : <NotFoundPage title="Unknown game" message={`There's no game ${gameId} in ${season} week ${week}.`} />
      }}
    </StateView>
  )
}

function MatchupSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading matchup">
      <Skeleton className="h-36 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

function MatchupView({ game }: { game: ScheduleGame }) {
  const a = game.away_team
  const b = game.home_team
  const chat = useChat()
  const manifest = useManifest()
  const stats = useTeamSeason({ season: game.season })
  const reports = useReportsIndex()
  const [focus, setFocus] = useState<Fact | null>(null)
  const final = game.home_score !== null && game.away_score !== null

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <header className="relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,var(--border)_0_1px,transparent_1px_40px)] opacity-40 [mask-image:linear-gradient(180deg,black,transparent)]" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase">
            <CalendarDays className="size-3.5" aria-hidden />
            {game.season} · week {game.week} · {gameDayText(game.gameday)}
            {gameTimeText(game.gametime) && ` · ${gameTimeText(game.gametime)}`}
            {game.stadium && <span className="hidden sm:inline"> · {game.stadium}</span>}
          </div>
          <Button variant="outline" size="sm" onClick={() => chat.open({ page: 'matchup', team: a, opponent: b, game_id: game.game_id })} aria-label="Ask the coordinators about this matchup">
            <MessageSquare aria-hidden /> Ask the coordinators
          </Button>
        </div>
        <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          <TeamSide team={a} score={game.away_score} won={final && game.away_score! > game.home_score!} final={final} label="Away" />
          <div className="text-center">
            <h1 id="page-title" className="font-display text-3xl font-bold text-muted-foreground uppercase sm:text-4xl">
              <span className="sr-only">
                {getTeam(a)?.name ?? a} at {getTeam(b)?.name ?? b}
              </span>
              <span aria-hidden>{final ? 'Final' : '@'}</span>
            </h1>
          </div>
          <TeamSide team={b} score={game.home_score} won={final && game.home_score! > game.away_score!} final={final} label="Home" align="right" />
        </div>
      </header>

      <StateView query={stats} label="team stats" skeleton={<Skeleton className="h-96 rounded-xl" />} isEmpty={(rows) => !rows.some((r) => r.team === a) || !rows.some((r) => r.team === b)} empty="Season stats for one of these teams aren’t available yet.">
        {(rows) => <Comparison a={rows.find((r) => r.team === a)!} b={rows.find((r) => r.team === b)!} nfl={rows.find((r) => r.team === 'NFL')} />}
      </StateView>

      <Panel title="Game-plan reports" description="Pre-generated by the AI coordinators. Every number is a stat chip: open one to see the fact behind it.">
        <StateView query={reports} label="reports" skeleton={<Skeleton className="h-64" />} isEmpty={() => false}>
          {(index) => {
            const slots = matchupReportSlots(index, game.game_id, a, b, manifest.data!)
            const first = slots.find((s) => s.entry) ?? slots[0]
            return (
              <Tabs defaultValue={first.key}>
                <div className="-mx-1 overflow-x-auto px-1 pb-1">
                  <TabsList aria-label="Reports">
                    {slots.map((s) => (
                      <TabsTrigger key={s.key} value={s.key} className="gap-1.5 px-3" aria-label={`${s.team} ${s.role} report${s.entry ? (s.entry.stale ? ' (stale)' : '') : ' (none)'}`}>
                        <TeamBadge team={s.team} size="xs" />
                        {s.role}
                        {!s.entry && <span className="text-[0.65rem] text-muted-foreground">—</span>}
                        {s.entry?.stale && <span className="size-1.5 rounded-full bg-warning" aria-hidden />}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {slots.map((s) => (
                  <TabsContent key={s.key} value={s.key} className="pt-3">
                    <ReportSlotView slot={s} onShowFact={setFocus} />
                  </TabsContent>
                ))}
              </Tabs>
            )
          }}
        </StateView>
      </Panel>

      {focus && <TendencyFocus fact={focus} onClear={() => setFocus(null)} />}
    </section>
  )
}

function TeamSide({ team, score, won, final, label, align }: { team: string; score: number | null; won: boolean; final: boolean; label: string; align?: 'right' }) {
  const t = getTeam(team)
  return (
    <Link
      to={ROUTE_PATHS.team(team)}
      aria-label={`${t?.name ?? team} team page`}
      className={cn('flex min-w-0 items-center gap-3 rounded-lg p-1 hover:bg-muted/50', align === 'right' && 'flex-row-reverse text-right')}
    >
      <TeamBadge team={team} size="lg" className="max-sm:size-10 max-sm:text-sm" />
      <div className="min-w-0">
        <div className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">{label}</div>
        <div className="truncate font-display text-xl leading-none font-bold tracking-wide uppercase sm:text-3xl">{t?.nickname ?? team}</div>
        {final && <div className={cn('mt-1 font-mono text-2xl tabular', won ? 'font-semibold' : 'text-muted-foreground')}>{score}</div>}
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------- comparison

type Key = keyof TeamSeasonRow
interface Row {
  label: string
  key: Key
  fmt: (v: number | null | undefined) => string | null
  /** 1 = higher is better, -1 = lower is better, 0 = descriptive. */
  better: 1 | -1 | 0
}

const COMPARE: { group: string; rows: Row[] }[] = [
  {
    group: 'Offense',
    rows: [
      { label: 'EPA / play', key: 'off_epa_per_play', fmt: signed, better: 1 },
      { label: 'Pass EPA', key: 'off_pass_epa', fmt: signed, better: 1 },
      { label: 'Run EPA', key: 'off_run_epa', fmt: signed, better: 1 },
      { label: 'Success rate', key: 'off_success_rate', fmt: pct, better: 1 },
      { label: 'PROE', key: 'off_proe', fmt: signedPct, better: 0 },
      { label: '3rd-down conv.', key: 'off_third_down_conv_rate', fmt: pct, better: 1 },
      { label: 'Red-zone TD rate', key: 'off_red_zone_td_rate', fmt: pct, better: 1 },
    ],
  },
  {
    group: 'Defense',
    rows: [
      { label: 'EPA / play allowed', key: 'def_epa_per_play', fmt: signed, better: -1 },
      { label: 'Success allowed', key: 'def_success_rate', fmt: pct, better: -1 },
      { label: 'Explosive allowed', key: 'def_explosive_rate', fmt: pct, better: -1 },
      { label: 'Blitz rate', key: 'def_blitz_rate', fmt: pct, better: 0 },
      { label: 'Pressure rate', key: 'def_pressure_rate', fmt: pct, better: 1 },
    ],
  },
]

const val = (r: TeamSeasonRow | undefined, k: Key): number | null => {
  const v = r?.[k]
  return typeof v === 'number' ? v : null
}
const rank = (r: TeamSeasonRow, k: Key): number | null => {
  const v = (r as unknown as Record<string, unknown>)[`rank_${k}`]
  return typeof v === 'number' ? v : null
}

function Comparison({ a, b, nfl }: { a: TeamSeasonRow; b: TeamSeasonRow; nfl?: TeamSeasonRow }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
      <Panel title="Tale of the tape" description="Season numbers with NFL ranks. The edge dot marks the better unit." bodyClassName="p-0 sm:p-0">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Season comparison, {a.team} vs {b.team}
          </caption>
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <TeamBadge team={a.team} size="xs" />
                  {a.team}
                </span>
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                Metric
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  {b.team}
                  <TeamBadge team={b.team} size="xs" />
                </span>
              </th>
            </tr>
          </thead>
          {COMPARE.map((g) => (
            <tbody key={g.group}>
              <tr>
                <th colSpan={3} scope="colgroup" className="bg-muted/40 px-4 py-1 text-left font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {g.group}
                </th>
              </tr>
              {g.rows.map((r) => {
                const va = val(a, r.key)
                const vb = val(b, r.key)
                const edge = r.better && va !== null && vb !== null && va !== vb ? ((va - vb) * r.better > 0 ? 'a' : 'b') : null
                const cellA = r.fmt(va)
                const cellB = r.fmt(vb)
                return (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('size-1.5 rounded-full', edge === 'a' ? 'bg-accent' : 'bg-transparent')} aria-hidden />
                        <span className="font-mono tabular">{cellA ?? <NA />}</span>
                        {cellA && rank(a, r.key) != null && <span className="font-mono text-[0.65rem] text-muted-foreground">#{rank(a, r.key)}</span>}
                      </span>
                    </td>
                    <th scope="row" className="px-2 py-2 text-center text-xs font-normal text-muted-foreground">
                      {r.label}
                      {nfl && r.fmt(val(nfl, r.key)) && <div className="font-mono text-[0.65rem]">NFL {r.fmt(val(nfl, r.key))}</div>}
                    </th>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {cellB && rank(b, r.key) != null && <span className="font-mono text-[0.65rem] text-muted-foreground">#{rank(b, r.key)}</span>}
                        <span className="font-mono tabular">{cellB ?? <NA />}</span>
                        <span className={cn('size-1.5 rounded-full', edge === 'b' ? 'bg-accent' : 'bg-transparent')} aria-hidden />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      </Panel>
      <div className="grid gap-6">
        <UnitVsUnit off={a} def={b} nfl={nfl} />
        <UnitVsUnit off={b} def={a} nfl={nfl} />
      </div>
    </div>
  )
}

function NA() {
  return (
    <span className="text-muted-foreground" title="Not available for this season">
      n/a
    </span>
  )
}

const UNIT_RATES: { label: string; off: Key; def: Key }[] = [
  { label: 'Success', off: 'off_success_rate', def: 'def_success_rate' },
  { label: 'Expl.', off: 'off_explosive_rate', def: 'def_explosive_rate' },
  { label: '3rd dn', off: 'off_third_down_conv_rate', def: 'def_third_down_conv_rate' },
  { label: 'RZ TD', off: 'off_red_zone_td_rate', def: 'def_red_zone_td_rate' },
]
const UNIT_EPA: { label: string; off: Key; def: Key }[] = [
  { label: 'EPA/play', off: 'off_epa_per_play', def: 'def_epa_per_play' },
  { label: 'Pass EPA', off: 'off_pass_epa', def: 'def_pass_epa' },
  { label: 'Run EPA', off: 'off_run_epa', def: 'def_run_epa' },
]

/** One team's offense against the other's defense: what the offense gains vs what the defense allows. */
function UnitVsUnit({ off, def, nfl }: { off: TeamSeasonRow; def: TeamSeasonRow; nfl?: TeamSeasonRow }) {
  const data = useMemo(
    () => UNIT_RATES.map((m) => ({ metric: m.label, off: val(off, m.off), def: val(def, m.def), nfl: val(nfl, m.off) })),
    [off, def, nfl],
  )
  return (
    <Panel title={`${off.team} offense vs ${def.team} defense`} description={`What ${off.team} gains against what ${def.team} allows.`}>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {UNIT_EPA.map((m) => {
          const o = val(off, m.off)
          const d = val(def, m.def)
          return (
            <div key={m.label} className="rounded-lg bg-muted/50 px-3 py-2">
              <div className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">{m.label}</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-mono text-sm tabular">
                <span className="font-semibold">{signed(o) ?? 'n/a'}</span>
                <span className="text-[0.65rem] text-muted-foreground">vs</span>
                <span>{signed(d) ?? 'n/a'}</span>
              </div>
            </div>
          )
        })}
      </div>
      <BarChart
        data={data}
        xKey="metric"
        layout="vertical"
        series={[
          { key: 'off', label: `${off.team} offense`, color: 'var(--accent)' },
          { key: 'def', label: `${def.team} defense allowed` },
          { key: 'nfl', label: 'NFL', color: 'var(--chart-ink-muted)' },
        ]}
        yFormat={fmtPct}
        ariaLabel={`${off.team} offense rates vs ${def.team} defense rates allowed`}
      />
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        Expl. = explosive-play rate · 3rd dn = third-down conversion rate · RZ TD = red-zone touchdown rate
      </p>
    </Panel>
  )
}
