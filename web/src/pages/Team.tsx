import { useMemo, useState } from 'react'
import { MessageSquare, ShieldHalf, Swords } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useChat } from '@/app/chat-context'
import { ROUTE_PATHS } from '@/app/routes'
import { BarChart, Heatmap, LineChart } from '@/components/charts'
import { Field, type FieldArrow, type FieldZone } from '@/components/field'
import { Stat } from '@/components/stat/Stat'
import { StateView } from '@/components/state/StateView'
import { TeamBadge } from '@/features/shared/TeamBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSeason, useTeam, useTeamSeason, useTeamWeek, useTendencies } from '@/data'
import { TeamAccentScope } from '@/design/useTeamAccent'
import type { Team, TeamSeasonRow, TeamTendencyRow, TeamWeekRow } from '@/types/generated'
import { fmtEpa, fmtPct, fmtSignedPct, pct, signed, signedPct, ZONE_LABEL, ZONES } from '@/features/shared/format'
import { Eyebrow, Panel } from '@/features/shared/layout'
import { downDistGrid, metricInvert, metricLabel, metricScale, type MetricKey, type Side } from '@/features/tendencies/tendencies'
import NotFoundPage from './NotFound'

export default function TeamPage() {
  const { abbr } = useParams()
  const team = useTeam(abbr)
  if (!team) {
    return (
      <NotFoundPage
        title="Unknown team"
        message={`There's no team with the abbreviation “${abbr ?? ''}”. Pick one from the Teams menu.`}
      />
    )
  }
  return <TeamView key={team.abbr} team={team} />
}

function TeamView({ team }: { team: Team }) {
  const { season } = useSeason()
  const chat = useChat()
  const seasonRows = useTeamSeason({ season, team: team.abbr })
  const weeks = useTeamWeek({ season, team: team.abbr })
  // All groupings for this team + the NFL baseline (NFL rows are side "off").
  const tendencies = useTendencies({ season, teams: [team.abbr, 'NFL'] })
  const row = seasonRows.data?.find((r) => r.team === team.abbr)
  const nfl = seasonRows.data?.find((r) => r.team === 'NFL')

  return (
    <TeamAccentScope team={team.abbr} className="space-y-6">
      <header className="relative overflow-hidden rounded-xl border bg-card">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-accent" aria-hidden />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[repeating-linear-gradient(90deg,var(--border)_0_1px,transparent_1px_32px)] opacity-50 [mask-image:linear-gradient(90deg,transparent,black)]" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:p-6">
          <TeamBadge team={team.abbr} size="lg" className="size-16 text-xl" />
          <div className="min-w-0 flex-1 basis-60">
            <div className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
              {team.division} · {season} season
            </div>
            <h1 id="page-title" className="font-display text-4xl leading-none font-bold tracking-wide uppercase sm:text-5xl">
              {team.name}
            </h1>
            {row && (
              <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                {row.games} games · {row.off_plays} offensive plays · {row.def_plays} defensive plays
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={() => chat.open({ page: 'team', team: team.abbr })} aria-label={`Ask the OC about the ${team.nickname}`}>
              <Swords aria-hidden /> Ask the OC
            </Button>
            <Button variant="outline" onClick={() => chat.open({ page: 'team', team: team.abbr })} aria-label={`Ask the DC about the ${team.nickname}`}>
              <ShieldHalf aria-hidden /> Ask the DC
            </Button>
          </div>
        </div>
      </header>

      <StateView
        query={seasonRows}
        label="season stats"
        isEmpty={(rows) => !rows.some((r) => r.team === team.abbr)}
        empty={`No ${season} stats for the ${team.nickname} yet.`}
        skeleton={<KpiSkeleton />}
      >
        {() => row && <Kpis row={row} nfl={nfl} />}
      </StateView>

      <div className="grid gap-6 xl:grid-cols-2">
        <Trend weeks={weeks} nfl={nfl} />
        <Proe weeks={weeks} row={row} nfl={nfl} loading={seasonRows.isPending} />
      </div>

      <StateView query={tendencies} label="tendencies" skeleton={<Skeleton className="h-96 rounded-xl" />} isEmpty={(rows) => !rows.some((r) => r.team === team.abbr)} empty={`No ${season} tendency data for the ${team.nickname}.`}>
        {(rows) => <Tendencies rows={rows} team={team} />}
      </StateView>

      <p className="text-xs text-muted-foreground">
        Looking for a game?{' '}
        <Link to={ROUTE_PATHS.dashboard} className="font-medium text-foreground underline underline-offset-4">
          The dashboard lists this week's matchups.
        </Link>
      </p>
    </TeamAccentScope>
  )
}

// ---------------------------------------------------------------- KPIs

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  )
}

type SeasonKey = keyof TeamSeasonRow
interface Kpi {
  label: string
  key: SeasonKey
  fmt: (v: number | null | undefined) => string | null
}

const OFF_KPIS: Kpi[] = [
  { label: 'EPA / play', key: 'off_epa_per_play', fmt: signed },
  { label: 'Success rate', key: 'off_success_rate', fmt: pct },
  { label: 'Explosive rate', key: 'off_explosive_rate', fmt: pct },
  { label: '3rd-down conv.', key: 'off_third_down_conv_rate', fmt: pct },
  { label: 'Red-zone TD rate', key: 'off_red_zone_td_rate', fmt: pct },
]
const DEF_KPIS: Kpi[] = [
  { label: 'EPA / play allowed', key: 'def_epa_per_play', fmt: signed },
  { label: 'Success allowed', key: 'def_success_rate', fmt: pct },
  { label: '3rd-down conv. allowed', key: 'def_third_down_conv_rate', fmt: pct },
  { label: 'Blitz rate', key: 'def_blitz_rate', fmt: pct },
  { label: 'Pressure rate', key: 'def_pressure_rate', fmt: pct },
]

function rankOf(row: TeamSeasonRow, key: SeasonKey): number | null {
  const v = (row as unknown as Record<string, unknown>)[`rank_${key}`]
  return typeof v === 'number' ? v : null
}

function Kpis({ row, nfl }: { row: TeamSeasonRow; nfl?: TeamSeasonRow }) {
  const tile = (k: Kpi) => {
    const v = row[k.key] as number | null
    return <Stat key={k.key} label={k.label} value={k.fmt(v)} rank={rankOf(row, k.key)} leagueValue={nfl ? k.fmt(nfl[k.key] as number | null) : null} />
  }
  return (
    <div className="space-y-4" aria-label="Season KPIs">
      <div>
        <Eyebrow className="mb-2">Offense</Eyebrow>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{OFF_KPIS.map(tile)}</div>
      </div>
      <div>
        <Eyebrow className="mb-2">Defense</Eyebrow>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{DEF_KPIS.map(tile)}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- trends

type TrendMetric = 'epa' | 'success'

function Trend({ weeks, nfl }: { weeks: ReturnType<typeof useTeamWeek>; nfl?: TeamSeasonRow }) {
  const [metric, setMetric] = useState<TrendMetric>('epa')
  const epa = metric === 'epa'
  return (
    <Panel
      title="Trend by week"
      description={epa ? 'EPA per play gained (offense) and allowed (defense).' : 'Success rate gained (offense) and allowed (defense).'}
      action={
        <ToggleGroup type="single" size="sm" variant="outline" value={metric} onValueChange={(v) => v && setMetric(v as TrendMetric)} aria-label="Trend metric">
          <ToggleGroupItem value="epa" aria-label="Show EPA per play">
            EPA/play
          </ToggleGroupItem>
          <ToggleGroupItem value="success" aria-label="Show success rate">
            Success
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      <StateView query={weeks} label="weekly results" skeleton={<Skeleton className="h-64" />} empty="No games played this season yet.">
        {(rows) => (
          <LineChart
            data={rows.map((r) => ({ week: r.week, off: epa ? r.off_epa_per_play : r.off_success_rate, def: epa ? r.def_epa_per_play : r.def_success_rate }))}
            xKey="week"
            xFormat={(w) => `Wk ${w}`}
            series={[
              { key: 'off', label: 'Offense', color: 'var(--accent)' },
              { key: 'def', label: 'Defense (allowed)', color: 'var(--chart-ink-muted)' },
            ]}
            yFormat={epa ? fmtEpa : fmtPct}
            referenceY={(epa ? nfl?.off_epa_per_play : nfl?.off_success_rate) != null ? { value: (epa ? nfl!.off_epa_per_play : nfl!.off_success_rate)!, label: 'NFL avg' } : undefined}
            ariaLabel={epa ? 'EPA per play by week' : 'Success rate by week'}
          />
        )}
      </StateView>
    </Panel>
  )
}

function Proe({ weeks, row, nfl, loading }: { weeks: ReturnType<typeof useTeamWeek>; row?: TeamSeasonRow; nfl?: TeamSeasonRow; loading: boolean }) {
  return (
    <Panel title="Pass rate over expected" description="PROE: how much more (or less) often the offense drops back than the situation predicts.">
      <div className="mb-4 grid grid-cols-2 gap-3">
        {loading ? (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        ) : (
          <>
            <Stat label="Season PROE" value={signedPct(row?.off_proe)} rank={row?.rank_off_proe} leagueValue={signedPct(nfl?.off_proe)} />
            <Stat label="Early-down pass rate" value={pct(row?.off_early_down_pass_rate)} rank={row?.rank_off_early_down_pass_rate} leagueValue={pct(nfl?.off_early_down_pass_rate)} />
          </>
        )}
      </div>
      <StateView
        query={weeks}
        label="weekly PROE"
        skeleton={<Skeleton className="h-44" />}
        isEmpty={(rows: TeamWeekRow[]) => !rows.some((r) => r.off_proe != null)}
        empty="Weekly PROE is not available for this season."
      >
        {(rows) => (
          <BarChart
            data={rows.map((r) => ({ week: `Wk ${r.week}`, proe: r.off_proe }))}
            xKey="week"
            series={[{ key: 'proe', label: 'PROE', color: 'var(--accent)' }]}
            yFormat={fmtSignedPct}
            referenceValue={{ value: 0 }}
            height={180}
            ariaLabel="PROE by week"
          />
        )}
      </StateView>
    </Panel>
  )
}

// ---------------------------------------------------------------- tendencies

const HEAT_METRICS: MetricKey[] = ['pass_rate', 'epa_per_play', 'success_rate', 'blitz_rate']

function Tendencies({ rows, team }: { rows: TeamTendencyRow[]; team: Team }) {
  const [side, setSide] = useState<Side>('off')
  const [metric, setMetric] = useState<MetricKey>('pass_rate')
  const grid = useMemo(() => downDistGrid(rows, team.abbr, side, metric), [rows, team.abbr, side, metric])
  const hasValues = grid.cells.some((c) => c.value !== null)
  const sideWord = side === 'off' ? 'offense' : 'defense'
  const find = (grouping: string, key: string, t = team.abbr, s: string = side) => rows.find((r) => r.team === t && r.side === s && r.grouping === grouping && r.cell_key === key)
  const overall = find('overall', 'all')
  const nflOverall = find('overall', 'all', 'NFL', 'off')

  const zones = useMemo(() => {
    const out: Partial<Record<FieldZone, { value: number; label?: string }>> = {}
    for (const z of ZONES) {
      const r = rows.find((x) => x.team === team.abbr && x.side === side && x.grouping === 'zone' && x.cell_key === z)
      if (r && r.epa_per_play != null) out[z] = { value: side === 'def' ? -r.epa_per_play : r.epa_per_play, label: signed(r.epa_per_play) ?? undefined }
    }
    return out
  }, [rows, team.abbr, side])

  const dirs = ['left', 'middle', 'right'] as const
  const runRates = dirs.map((d) => overall?.[`run_${d}_rate`] ?? null)
  const arrows: FieldArrow[] = dirs.flatMap((d, i) => (runRates[i] == null ? [] : [{ kind: 'run' as const, dir: d, weight: runRates[i]!, label: pct(runRates[i]) ?? undefined }]))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold tracking-wide uppercase">Tendencies</h2>
        <ToggleGroup type="single" variant="outline" value={side} onValueChange={(v) => v && setSide(v as Side)} aria-label="Offense or defense tendencies">
          <ToggleGroupItem value="off" aria-label="Show offense tendencies">
            Offense
          </ToggleGroupItem>
          <ToggleGroupItem value="def" aria-label="Show defense tendencies">
            Defense
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Panel
        title={`Down & distance · ${metricLabel(metric)}`}
        description={side === 'def' ? 'What the defense allowed (or did) by the offense’s down and distance. Hatched cells have fewer than 20 plays.' : 'By down and distance. Hatched cells have fewer than 20 plays.'}
        action={
          <ToggleGroup type="single" size="sm" variant="outline" value={metric} onValueChange={(v) => v && setMetric(v as MetricKey)} aria-label="Heatmap metric" className="flex-wrap">
            {HEAT_METRICS.filter((m) => side === 'def' || m !== 'blitz_rate').map((m) => (
              <ToggleGroupItem key={m} value={m} aria-label={`Color by ${metricLabel(m)}`}>
                {metricLabel(m)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        {hasValues ? (
          <Heatmap
            rows={grid.rows}
            cols={grid.cols}
            cells={grid.cells}
            rowLabel={grid.rowLabel}
            colLabel={grid.colLabel}
            colorScale={metricScale(metric)}
            invert={metricInvert(metric, side)}
            legend={metricScale(metric) === 'diverging' ? (side === 'def' ? ['Better D', 'Worse D'] : ['Worse', 'Better']) : ['Lower', 'Higher']}
            ariaLabel={`${team.abbr} ${sideWord} ${metricLabel(metric)} by down and distance`}
          />
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{metricLabel(metric)} is not available for this season.</p>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Panel
          title="By field zone"
          description={`EPA per play ${side === 'def' ? 'allowed' : 'gained'} in each zone (shading: better for this ${sideWord} is bluer). Arrows show run direction share.`}
        >
          {Object.keys(zones).length || arrows.length ? (
            <>
              <Field zones={zones} zoneScale="diverging" arrows={arrows} ariaLabel={`${team.abbr} ${sideWord} EPA per play by field zone, with run direction`} />
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                {ZONES.map((z) => {
                  const r = find('zone', z)
                  return (
                    <li key={z} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{ZONE_LABEL[z]}</span>
                      <span className="font-mono tabular">{r ? `${signed(r.epa_per_play) ?? 'n/a'} · ${r.plays}` : 'n/a'}</span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No field-zone data for this season.</p>
          )}
        </Panel>

        <Panel title="Run direction" description={`Share of ${side === 'def' ? 'runs faced' : 'runs'} by direction, against the NFL.`}>
          {runRates.some((v) => v != null) ? (
            <BarChart
              data={dirs.map((d) => ({ dir: d[0].toUpperCase() + d.slice(1), team: overall?.[`run_${d}_rate`] ?? null, nfl: nflOverall?.[`run_${d}_rate`] ?? null }))}
              xKey="dir"
              series={[
                { key: 'team', label: team.abbr, color: 'var(--accent)' },
                { key: 'nfl', label: 'NFL', color: 'var(--chart-ink-muted)' },
              ]}
              yFormat={fmtPct}
              height={240}
              ariaLabel={`${team.abbr} run direction share vs NFL`}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Run direction is not available for this season.</p>
          )}
        </Panel>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <MessageSquare className="size-3.5" aria-hidden /> Questions about these tendencies? The coordinators can explain them in the chat.
      </p>
    </div>
  )
}
