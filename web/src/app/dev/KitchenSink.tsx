// Dev-only (/dev/kitchen-sink): every shell component and chart in both themes, with and without a team accent.
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { BarChart, Heatmap, LineChart, ScatterChart, type HeatmapCell } from '@/components/charts'
import { Field, type FieldArrow } from '@/components/field'
import { Stat } from '@/components/stat/Stat'
import { StateView } from '@/components/state/StateView'
import { TeamLogo } from '@/components/team/TeamLogo'
import { TeamMonogram } from '@/components/team/TeamMonogram'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getTeam, useManifest, useTeamSeason, useTeams } from '@/data'
import { useSeason } from '@/data/season'
import { contrastRatio } from '@/design/color'
import { surfaceContrast } from '@/design/accent'
import { getTeamAccent, TeamAccentScope, useTeamAccent } from '@/design/useTeamAccent'
import { cn } from '@/lib/utils'

// Deterministic synthetic data (no Math.random, so screenshots are stable).
const wave = (i: number, k: number) => Math.round((Math.sin(i * 0.9 + k) * 0.12 + Math.cos(i * 0.4 + k * 2) * 0.05) * 1000) / 1000
const WEEKS = Array.from({ length: 12 }, (_, i) => ({ week: i + 1, off: wave(i, 1), def: wave(i, 2.5), nfl: 0 }))
const BARS = ['KC', 'BUF', 'BAL', 'DET', 'PHI', 'SF'].map((t, i) => ({ team: t, epa: Math.round((0.18 - i * 0.045) * 1000) / 1000, sr: 0.5 - i * 0.02 }))
const DOWNS = ['1st', '2nd', '3rd', '4th']
const DISTS = ['short', 'medium', 'long', 'very_long']
const HEAT: HeatmapCell[] = DOWNS.flatMap((d, i) =>
  DISTS.map((c, j) => {
    const v = i === 3 && j === 3 ? null : Math.round((0.35 + i * 0.12 + j * 0.08 - (i * j) / 60) * 100) / 100
    return { row: d, col: c, value: v, display: v === null ? undefined : `${Math.round(v * 100)}%`, lowSample: i === 3 && j > 0, detail: `${120 - i * 25 - j * 8} plays` }
  }),
)
const HEAT_DIV: HeatmapCell[] = HEAT.map((c) => (c.value === null ? c : { ...c, value: c.value - 0.55, display: (c.value - 0.55 >= 0 ? '+' : '') + (c.value - 0.55).toFixed(2) }))
const ARROWS: FieldArrow[] = [
  { kind: 'run', dir: 'left', weight: 0.3, label: '28%' },
  { kind: 'run', dir: 'middle', weight: 0.5, label: '44%' },
  { kind: 'run', dir: 'right', weight: 0.25, label: '28%' },
  { kind: 'pass', dir: 'left', weight: 0.35, label: '31%' },
  { kind: 'pass', dir: 'right', weight: 0.6, label: '47%' },
]
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
const pct = (v: number) => `${Math.round(v * 100)}%`

const fakeQuery = <T,>(state: 'loading' | 'error' | 'empty' | 'ok', data: T) => ({
  data: state === 'ok' ? data : state === 'empty' ? ([] as unknown as T) : undefined,
  error: state === 'error' ? new Error('GET /Audible/data/team_week.parquet failed: 500') : null,
  isPending: state === 'loading',
  isError: state === 'error',
  fetchStatus: state === 'loading' ? 'fetching' : 'idle',
  refetch: async () => {
    toast('Retry clicked')
    return undefined as never
  },
})

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      <h3 className="font-display text-sm font-bold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Panel({ theme, team, full }: { theme: 'light' | 'dark'; team?: string; full: boolean }) {
  const [ball, setBall] = useState(35)
  const [side, setSide] = useState('off')
  return (
    <TeamAccentScope team={team} data-panel={`${theme}-${team ?? 'neutral'}`} className={cn(theme, 'min-w-0 rounded-xl border bg-background p-4 text-foreground sm:p-6')}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-2xl font-bold uppercase">
          {theme} · {team ?? 'neutral'}
        </h2>
        {team && <TeamMonogram team={team} size="md" />}
      </div>
      <div className="space-y-8">
        <Section title="Buttons & badges">
          <div className="flex flex-wrap gap-2">
            <Button aria-label="Default button">Default</Button>
            <Button variant="accent" aria-label="Accent button">Accent</Button>
            <Button variant="secondary" aria-label="Secondary button">Secondary</Button>
            <Button variant="outline" aria-label="Outline button">Outline</Button>
            <Button variant="ghost" aria-label="Ghost button">Ghost</Button>
            <Button variant="destructive" aria-label="Destructive button">Destructive</Button>
            <Button variant="link" aria-label="Link button">Link</Button>
            <Button disabled aria-label="Disabled button">Disabled</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Failed</Badge>
          </div>
          <p className="text-sm">
            Accent as text: <span className="font-medium text-accent">Attack the blitz on 3rd &amp; long</span>
          </p>
        </Section>

        <Section title="Stats">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="EPA / play" value="+0.14" rank={3} leagueValue="+0.00" />
            <Stat label="Success rate" value="47%" rank={12} leagueValue="45%" />
            <Stat label="PROE" value="-2%" rank={30} caption="Pass rate over expected" />
            <Stat label="Blitz rate" value={null} />
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${theme}-${team}-in`}>Distance</Label>
              <Input id={`${theme}-${team}-in`} type="number" defaultValue={7} />
            </div>
            <div className="space-y-1.5">
              <Label id={`${theme}-${team}-sel`}>Grouping</Label>
              <Select defaultValue="down_dist">
                <SelectTrigger aria-labelledby={`${theme}-${team}-sel`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="down_dist">Down &amp; distance</SelectItem>
                  <SelectItem value="zone">Field zone</SelectItem>
                  <SelectItem value="score_time">Score &amp; time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ToggleGroup type="single" value={side} onValueChange={(v) => v && setSide(v)} variant="outline" aria-label="Side">
            <ToggleGroupItem value="off" aria-label="Offense">
              Offense
            </ToggleGroupItem>
            <ToggleGroupItem value="def" aria-label="Defense">
              Defense
            </ToggleGroupItem>
          </ToggleGroup>
          <Tabs defaultValue="oc">
            <TabsList>
              <TabsTrigger value="oc">OC report</TabsTrigger>
              <TabsTrigger value="dc">DC report</TabsTrigger>
            </TabsList>
            <TabsContent value="oc" className="text-sm text-muted-foreground">
              Offensive coordinator tab content.
            </TabsContent>
            <TabsContent value="dc" className="text-sm text-muted-foreground">
              Defensive coordinator tab content.
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Card, alert, table">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-xl uppercase">KC @ BAL</CardTitle>
              <CardDescription>Week 4 · Sun 8:20 PM</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">Card body.</CardContent>
          </Card>
          <Alert>
            <Info aria-hidden />
            <AlertTitle>Sample mode</AlertTitle>
            <AlertDescription>Live AI runs on the owner&apos;s machine — this is a sample call.</AlertDescription>
          </Alert>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">EPA/play</TableHead>
                <TableHead className="text-right">SR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {BARS.slice(0, 3).map((b) => (
                <TableRow key={b.team}>
                  <TableCell className="font-medium">{b.team}</TableCell>
                  <TableCell className="text-right font-mono tabular">{signed(b.epa)}</TableCell>
                  <TableCell className="text-right font-mono tabular">{pct(b.sr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="StateView: loading / error / empty">
          <div className="grid gap-3 md:grid-cols-3">
            <StateView query={fakeQuery('loading', [1])} label="team weeks">
              {() => null}
            </StateView>
            <StateView query={fakeQuery('error', [1])} label="team weeks">
              {() => null}
            </StateView>
            <StateView query={fakeQuery('empty', [1])} label="team weeks" empty="No games yet this season.">
              {() => null}
            </StateView>
          </div>
          <Skeleton className="h-6 w-1/2" />
        </Section>

        {full && (
          <>
            <Section title="LineChart">
              <LineChart
                data={WEEKS}
                xKey="week"
                series={[
                  { key: 'off', label: 'Offense EPA/play', color: 'var(--accent)' },
                  { key: 'def', label: 'Defense EPA/play allowed', color: 'var(--chart-ink-muted)' },
                ]}
                yFormat={signed}
                xFormat={(w) => `Wk ${w}`}
                referenceY={{ value: 0, label: 'NFL avg' }}
                ariaLabel="EPA per play by week"
              />
            </Section>
            <Section title="BarChart (vertical bars, horizontal bars w/ highlight)">
              <div className="grid gap-4 md:grid-cols-2">
                <BarChart data={BARS} xKey="team" series={[{ key: 'epa', label: 'EPA/play' }, { key: 'sr', label: 'Success rate' }]} yFormat={(v) => v.toFixed(2)} ariaLabel="Top offenses" />
                <BarChart data={BARS} xKey="team" series={[{ key: 'epa', label: 'EPA/play' }]} layout="vertical" yFormat={signed} highlight={[team ?? 'KC']} ariaLabel="Top offenses ranked" />
              </div>
            </Section>
            <Section title="ScatterChart">
              <ScatterChart
                data={BARS.concat(BARS.map((b, i) => ({ team: `T${i}`, epa: -b.epa / 2, sr: 0.42 + i * 0.01 })))}
                xKey="epa"
                yKey="sr"
                labelKey="team"
                xLabel="Off. EPA/play"
                yLabel="Success rate"
                xFormat={signed}
                yFormat={pct}
                highlight={team ? [team] : undefined}
                referenceX={0}
                height={300}
              />
              <ScatterChart
                data={BARS}
                xKey="epa"
                yKey="sr"
                labelKey="team"
                xLabel="Off. EPA/play"
                yLabel="Success rate"
                xFormat={signed}
                yFormat={pct}
                pointImage={(r) => (getTeam(r.team) as { logo_url?: string | null } | undefined)?.logo_url}
                highlight={team ? [team] : undefined}
                referenceX={0}
                height={300}
                ariaLabel="Scatter with team logos"
              />
            </Section>
            <Section title="Heatmap (sequential / diverging)">
              <div className="grid gap-4 xl:grid-cols-2">
                <Heatmap rows={DOWNS} cols={DISTS} cells={HEAT} colorScale="sequential" ariaLabel="Pass rate by down and distance" legend={['Run-heavy', 'Pass-heavy']} onCellClick={(c) => toast(`${c.row} & ${c.col}: ${c.display}`)} />
                <Heatmap rows={DOWNS} cols={DISTS} cells={HEAT_DIV} colorScale="diverging" ariaLabel="EPA per play vs league by down and distance" legend={['Below avg', 'Above avg']} />
              </div>
            </Section>
            <Section title="Field (drag the ball or focus it and use arrow keys)">
              <Field
                zones={{ backed_up: { value: -0.12, label: '-0.12' }, own_territory: { value: 0.02, label: '+0.02' }, opp_territory: { value: 0.09, label: '+0.09' }, red_zone: { value: 0.21, label: '+0.21' } }}
                arrows={ARROWS}
                ballOn={ball}
                distance={7}
                onBallChange={setBall}
                ariaLabel="Field with EPA by zone"
              />
              <Field zones={{ backed_up: { value: 12 }, own_territory: { value: 48 }, opp_territory: { value: 31 }, red_zone: { value: 9 } }} ariaLabel="Plays by zone" />
            </Section>
          </>
        )}
      </div>
    </TeamAccentScope>
  )
}

function Overlays() {
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" aria-label="Open dialog">
            Dialog
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stat source</DialogTitle>
            <DialogDescription>BAL.def.2026.down_dist.d3-long.blitz_rate</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" aria-label="Open sheet">
            Sheet
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Player card</SheetTitle>
            <SheetDescription>Season splits.</SheetDescription>
          </SheetHeader>
          <ScrollArea className="h-64 px-4">
            {Array.from({ length: 30 }, (_, i) => (
              <p key={i} className="py-1 text-sm">
                Row {i + 1}
              </p>
            ))}
          </ScrollArea>
        </SheetContent>
      </Sheet>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" aria-label="Open popover">
            Popover
          </Button>
        </PopoverTrigger>
        <PopoverContent className="text-sm">Popover content.</PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" aria-label="Show tooltip">
            Tooltip
          </Button>
        </TooltipTrigger>
        <TooltipContent>41% vs NFL 29%</TooltipContent>
      </Tooltip>
      <Button variant="outline" onClick={() => toast.success('Report loaded')} aria-label="Show toast">
        Toast
      </Button>
    </div>
  )
}

function AccentTable() {
  const teams = useTeams()
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead>Light accent</TableHead>
            <TableHead className="text-right">vs surface</TableHead>
            <TableHead className="text-right">fg</TableHead>
            <TableHead>Dark accent</TableHead>
            <TableHead className="text-right">vs surface</TableHead>
            <TableHead className="text-right">fg</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teams.map((t) => {
            const a = getTeamAccent(t.abbr)!
            return (
              <TableRow key={t.abbr}>
                <TableCell className="font-medium">{t.abbr}</TableCell>
                {(['light', 'dark'] as const).map((th) => (
                  <AccentCells key={th} theme={th} accent={a[th].accent} fg={a[th].foreground} note={`${a[th].source}${a[th].adjusted ? ' (adj.)' : ''}`} />
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function AccentCells({ theme, accent, fg, note }: { theme: 'light' | 'dark'; accent: string; fg: string; note: string }) {
  return (
    <>
      <TableCell>
        <span className={cn(theme, 'inline-flex items-center gap-2 rounded bg-background px-2 py-1')}>
          <span className="rounded px-2 py-0.5 font-mono text-xs" style={{ backgroundColor: accent, color: fg }}>
            {accent}
          </span>
          <span className="text-xs text-muted-foreground">{note}</span>
        </span>
      </TableCell>
      <TableCell className="text-right font-mono tabular">{surfaceContrast(accent, theme).toFixed(2)}</TableCell>
      <TableCell className="text-right font-mono tabular">{contrastRatio(accent, fg).toFixed(2)}</TableCell>
    </>
  )
}

function LiveData() {
  const { season } = useSeason()
  const manifest = useManifest()
  const ts = useTeamSeason({ season, team: 'KC' })
  return (
    <div className="grid gap-3 text-sm md:grid-cols-2">
      <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(manifest.data, null, 2)?.slice(0, 600)}</pre>
      <StateView query={ts} label="team season (DuckDB-WASM)">
        {(rows) => (
          <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs" data-testid="duckdb-result">
            {rows.map((r) => `${r.team}  off_epa=${r.off_epa_per_play?.toFixed(3)}  rank=${r.rank_off_epa_per_play ?? '-'}`).join('\n')}
          </pre>
        )}
      </StateView>
    </div>
  )
}

export default function KitchenSink() {
  const teams = useTeams()
  const [team, setTeam] = useState('KC')
  const [pageAccent, setPageAccent] = useState(false)
  useTeamAccent(pageAccent ? team : undefined)
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="font-mono text-xs text-muted-foreground">/dev/kitchen-sink · dev builds only</p>
        <h1 className="font-display text-5xl font-extrabold uppercase">Kitchen sink</h1>
        <div className="chalk-rule" />
        <div className="flex flex-wrap items-center gap-3">
          <Label id="ks-team">Accent team</Label>
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger aria-labelledby="ks-team" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.abbr} value={t.abbr}>
                  {t.abbr} · {t.nickname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant={pageAccent ? 'accent' : 'outline'} onClick={() => setPageAccent((v) => !v)} aria-pressed={pageAccent} aria-label="Apply accent to the whole page">
            Page accent {pageAccent ? 'on' : 'off'}
          </Button>
          <Overlays />
        </div>
      </header>

      <Section title="Live data (manifest + DuckDB-WASM query)">
        <LiveData />
      </Section>

      <div className="grid gap-6 2xl:grid-cols-2">
        <Panel theme="light" full />
        <Panel theme="dark" full />
        <Panel theme="light" team={team} full />
        <Panel theme="dark" team={team} full />
      </div>

      <Section title="TeamLogo (logo + wordmark, both themes; monogram fallback on null/error)">
        <div className="grid gap-4 xl:grid-cols-2">
          {(['light', 'dark'] as const).map((th) => (
            <div key={th} className={cn(th, 'rounded-xl border bg-card p-4 text-card-foreground')}>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
                {teams.map((t) => (
                  <div key={t.abbr} className="flex flex-col items-center gap-1">
                    <TeamLogo team={t.abbr} size="md" />
                    <span className="font-mono text-[0.65rem] text-muted-foreground">{t.abbr}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <TeamLogo team={team} variant="wordmark" size="md" />
                <TeamLogo team="XXX" size="md" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Separator />
      <Section title="All 32 team accents (contrast ≥ 4.5 vs every surface; fg ≥ 4.5 on accent)">
        <AccentTable />
      </Section>
    </div>
  )
}
