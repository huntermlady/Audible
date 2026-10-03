import { useId, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import { Link } from 'react-router'
import { ROUTE_PATHS } from '@/app/routes'
import { LineChart } from '@/components/charts'
import { StateView } from '@/components/state/StateView'
import { TeamBadge } from '@/features/shared/TeamBadge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { dataKeys, fetchPlayers, getTeam, usePlayers, useSeason } from '@/data'
import type { PlayerSeasonRow } from '@/types/generated'
import { num, pct, signed } from '@/features/shared/format'
import { PageHeader, Panel } from '@/features/shared/layout'
import { cn } from '@/lib/utils'

type Position = PlayerSeasonRow['position']
type Key = keyof PlayerSeasonRow
const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE']

interface Column {
  key: Key
  label: string
  title: string
  fmt: (v: number | null | undefined) => string | null
}

const c = (key: Key, label: string, title: string, fmt: Column['fmt'] = (v) => num(v)): Column => ({ key, label, title, fmt })
const epa2 = (v: number | null | undefined) => signed(v)
const dec1 = (v: number | null | undefined) => num(v, 1)
const cpoe = (v: number | null | undefined) => (v == null ? null : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)

const COLUMNS: Record<Position, Column[]> = {
  QB: [
    c('games', 'G', 'Games'),
    c('pass_att', 'Att', 'Pass attempts'),
    c('completions', 'Cmp', 'Completions'),
    c('pass_yds', 'Yds', 'Passing yards'),
    c('pass_td', 'TD', 'Passing touchdowns'),
    c('interceptions', 'INT', 'Interceptions'),
    c('sacks', 'Sk', 'Sacks'),
    c('epa_per_dropback', 'EPA/db', 'EPA per dropback', epa2),
    c('cpoe', 'CPOE', 'Completion % over expected', cpoe),
    c('any_a', 'ANY/A', 'Adjusted net yards per attempt', dec1),
    c('rush_yds', 'Rush yds', 'Rushing yards'),
  ],
  RB: [
    c('games', 'G', 'Games'),
    c('rush_att', 'Att', 'Rush attempts'),
    c('rush_yds', 'Yds', 'Rushing yards'),
    c('rush_td', 'TD', 'Rushing touchdowns'),
    c('epa_per_rush', 'EPA/rush', 'EPA per rush', epa2),
    c('rush_success_rate', 'Succ', 'Rush success rate', (v) => pct(v)),
    c('targets', 'Tgt', 'Targets'),
    c('receptions', 'Rec', 'Receptions'),
    c('rec_yds', 'Rec yds', 'Receiving yards'),
  ],
  WR: [],
  TE: [],
}
COLUMNS.WR = [
  c('games', 'G', 'Games'),
  c('targets', 'Tgt', 'Targets'),
  c('receptions', 'Rec', 'Receptions'),
  c('rec_yds', 'Yds', 'Receiving yards'),
  c('rec_td', 'TD', 'Receiving touchdowns'),
  c('epa_per_target', 'EPA/tgt', 'EPA per target', epa2),
  c('target_share', 'Tgt %', 'Target share', (v) => pct(v)),
  c('air_yards_share', 'Air %', 'Air-yards share', (v) => pct(v)),
  c('yac_per_rec', 'YAC/rec', 'Yards after catch per reception', dec1),
]
COLUMNS.TE = COLUMNS.WR

/** The volume stat the min-volume filter applies to. */
const VOLUME: Record<Position, { key: Key; label: string }> = {
  QB: { key: 'pass_att', label: 'attempts' },
  RB: { key: 'rush_att', label: 'carries' },
  WR: { key: 'targets', label: 'targets' },
  TE: { key: 'targets', label: 'targets' },
}
const DEFAULT_SORT: Record<Position, Key> = { QB: 'epa_per_dropback', RB: 'rush_yds', WR: 'rec_yds', TE: 'rec_yds' }

const numVal = (r: PlayerSeasonRow, k: Key): number | null => {
  const v = r[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export default function PlayersPage() {
  const { season } = useSeason()
  const [position, setPosition] = useState<Position>('QB')
  const [selected, setSelected] = useState<PlayerSeasonRow | null>(null)
  const players = usePlayers({ season, position })

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <PageHeader eyebrow={`${season} regular season`} title="Players" description="Leaderboards by position. Sort any column, raise the volume floor to cut small samples, and open a player for season-by-season splits." />
      <Tabs value={position} onValueChange={(v) => setPosition(v as Position)}>
        <TabsList aria-label="Position">
          {POSITIONS.map((p) => (
            <TabsTrigger key={p} value={p} className="px-4 font-display text-base tracking-wide" aria-label={`${p} leaderboard`}>
              {p}
            </TabsTrigger>
          ))}
        </TabsList>
        {POSITIONS.map((p) => (
          <TabsContent key={p} value={p} className="pt-4">
            <StateView query={players} label="players" skeleton={<Skeleton className="h-[28rem] rounded-xl" />} empty={`No ${position} stats for ${season} yet.`}>
              {(rows) => <Leaderboard key={`${position}-${season}`} rows={rows} position={position} onSelect={setSelected} />}
            </StateView>
          </TabsContent>
        ))}
      </Tabs>
      <PlayerSheet player={selected} onClose={() => setSelected(null)} />
    </section>
  )
}

function Leaderboard({ rows, position, onSelect }: { rows: PlayerSeasonRow[]; position: Position; onSelect: (p: PlayerSeasonRow) => void }) {
  const id = useId()
  const columns = COLUMNS[position]
  const volume = VOLUME[position]
  const maxVolume = Math.max(0, ...rows.map((r) => numVal(r, volume.key) ?? 0))
  // Default floor: a quarter of the leader's volume, so early-season boards aren't empty.
  const [minVolume, setMinVolume] = useState(() => String(Math.floor(maxVolume * 0.25)))
  const [sort, setSort] = useState<{ key: Key; dir: 'asc' | 'desc' }>({ key: DEFAULT_SORT[position], dir: 'desc' })
  const [query, setQuery] = useState('')

  const floor = Number(minVolume) || 0
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter((r) => (numVal(r, volume.key) ?? 0) >= floor && (!q || r.player_name.toLowerCase().includes(q) || r.team.toLowerCase() === q))
    const dir = sort.dir === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      if (sort.key === 'player_name') return dir * a.player_name.localeCompare(b.player_name)
      const va = numVal(a, sort.key)
      const vb = numVal(b, sort.key)
      if (va === null && vb === null) return 0
      if (va === null) return 1 // nulls last either way
      if (vb === null) return -1
      return dir * (va - vb)
    })
  }, [rows, floor, volume.key, sort, query])

  const toggleSort = (key: Key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'player_name' ? 'asc' : 'desc' }))
  const header = (key: Key, label: string, title: string, align: 'left' | 'right' = 'right') => {
    const active = sort.key === key
    const Icon = active ? (sort.dir === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown
    return (
      <th key={key} scope="col" aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'} className={cn('px-2 py-2 font-medium whitespace-nowrap', align === 'right' ? 'text-right' : 'text-left')}>
        <button
          type="button"
          onClick={() => toggleSort(key)}
          title={title}
          aria-label={`Sort by ${title}`}
          className={cn('inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', active && 'text-foreground', align === 'right' && 'flex-row-reverse')}
        >
          {label}
          <Icon className={cn('size-3', !active && 'opacity-40')} aria-hidden />
        </button>
      </th>
    )
  }

  return (
    <Panel
      title={`${position} leaderboard`}
      description={`${shown.length} of ${rows.length} players`}
      action={
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-q`} className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or team" className="h-8 w-40 pl-7 text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-min`} className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">
              Min {volume.label}
            </Label>
            <Input id={`${id}-min`} type="number" min={0} inputMode="numeric" value={minVolume} onChange={(e) => setMinVolume(e.target.value)} className="h-8 w-24 font-mono text-sm" />
          </div>
        </div>
      }
      bodyClassName="p-0 sm:p-0"
    >
      {shown.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No players match. Lower the minimum {volume.label} or clear the search.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {position} leaderboard, sorted by {sort.key} {sort.dir === 'desc' ? 'descending' : 'ascending'}
            </caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="sticky left-0 z-10 w-8 bg-card px-2 py-2 text-right font-medium">
                  #
                </th>
                {header('player_name', 'Player', 'Player name', 'left')}
                {columns.map((col) => header(col.key, col.label, col.title))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.player_id}-${r.team}`} className="group border-b last:border-0 hover:bg-muted/40">
                  <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-right font-mono text-xs text-muted-foreground tabular group-hover:bg-muted">{i + 1}</td>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => onSelect(r)}
                      aria-label={`Open ${r.player_name} (${r.team}) splits`}
                      className="flex items-center gap-2 rounded text-left font-medium whitespace-nowrap hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <TeamBadge team={r.team} size="xs" />
                      {r.player_name}
                    </button>
                  </th>
                  {columns.map((col) => {
                    const text = col.fmt(numVal(r, col.key))
                    return (
                      <td key={col.key} className={cn('px-2 py-1.5 text-right font-mono whitespace-nowrap tabular', sort.key === col.key && 'bg-accent-soft font-medium', text === null && 'text-muted-foreground')}>
                        {text ?? '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------- player drawer

const HEADLINE: Record<Position, Key> = { QB: 'epa_per_dropback', RB: 'epa_per_rush', WR: 'epa_per_target', TE: 'epa_per_target' }

function PlayerSheet({ player, onClose }: { player: PlayerSeasonRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!player} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {player && <PlayerSplits player={player} />}
      </SheetContent>
    </Sheet>
  )
}

function PlayerSplits({ player }: { player: PlayerSeasonRow }) {
  const { seasons } = useSeason()
  // One cached query per season (same keys as usePlayers), then this player's rows.
  const results = useQueries({
    queries: seasons.map((s) => ({ queryKey: dataKeys.players({ season: s, position: player.position }), queryFn: () => fetchPlayers({ season: s, position: player.position }) })),
  })
  const pending = results.some((r) => r.isPending)
  const failed = results.find((r) => r.isError)
  const rows = results
    .flatMap((r) => r.data ?? [])
    .filter((r) => r.player_id === player.player_id)
    .sort((a, b) => a.season - b.season || a.team.localeCompare(b.team))
  const columns = COLUMNS[player.position]
  const headline = HEADLINE[player.position]
  const team = getTeam(player.team)

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-center gap-3 pr-8">
          <TeamBadge team={player.team} size="md" />
          <div className="min-w-0">
            <SheetTitle className="font-display text-2xl leading-none tracking-wide uppercase">{player.player_name}</SheetTitle>
            <SheetDescription>
              {player.position} ·{' '}
              <Link to={ROUTE_PATHS.team(player.team)} className="underline underline-offset-2" aria-label={`${team?.name ?? player.team} team page`}>
                {team?.name ?? player.team}
              </Link>
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="space-y-6 p-4">
        <StateView
          query={{
            data: rows,
            error: failed?.error ?? null,
            isPending: pending,
            isError: !!failed,
            fetchStatus: pending ? 'fetching' : 'idle',
            refetch: () => (failed ? failed.refetch() : Promise.resolve(undefined as never)),
          }}
          label="season splits"
          skeleton={<Skeleton className="h-64" />}
          empty="No season rows for this player."
        >
          {(splits) => (
            <>
              {splits.some((s) => numVal(s, headline) !== null) && splits.length > 1 && (
                <div>
                <p className="mb-1 font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">{columns.find((col) => col.key === headline)?.title} by season</p>
                <LineChart
                  data={splits.map((s) => ({ season: `${s.season}${splits.filter((x) => x.season === s.season).length > 1 ? ` ${s.team}` : ''}`, v: numVal(s, headline) }))}
                  xKey="season"
                  series={[{ key: 'v', label: columns.find((col) => col.key === headline)?.title ?? String(headline), color: 'var(--accent)' }]}
                  yFormat={(v) => signed(v) ?? ''}
                  referenceY={{ value: 0 }}
                  height={180}
                  ariaLabel={`${player.player_name} ${String(headline).replaceAll('_', ' ')} by season`}
                />
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <caption className="sr-only">{player.player_name} season splits</caption>
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th scope="col" className="px-2 py-1.5 text-left font-medium">
                        Season
                      </th>
                      {columns.map((col) => (
                        <th key={col.key} scope="col" title={col.title} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {splits.map((s) => (
                      <tr key={`${s.season}-${s.team}`} className="border-b last:border-0">
                        <th scope="row" className="px-2 py-1.5 text-left font-mono font-normal whitespace-nowrap">
                          {s.season} <span className="text-muted-foreground">{s.team}</span>
                        </th>
                        {columns.map((col) => (
                          <td key={col.key} className="px-2 py-1.5 text-right font-mono whitespace-nowrap tabular">
                            {col.fmt(numVal(s, col.key)) ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </StateView>
      </div>
    </>
  )
}
