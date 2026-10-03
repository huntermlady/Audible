// @vitest-environment node
// Runs the real data layer (manifest → lazy parquet registration → SQL) against repo-root data/
// (from `make mock-data` or `make data`) through a Node DuckDB engine. fetch is served from disk.
import fs from 'node:fs'
import path from 'node:path'
import { fetchManifest, resetManifestCache } from '@/data/manifest'
import { setQueryEngine } from '@/data/engine'
import { resetTables } from '@/data/tables'
import { fetchPlayers, fetchPlaycallerSamples, fetchReportsIndex, fetchSchedule, fetchTeamSeason, fetchTeamWeek, fetchTendencies, resetScheduleCache } from '@/data/fetchers'
import { createNodeEngine } from './helpers/node-engine'

const REPO = path.resolve(__dirname, '../..')
const hasData = fs.existsSync(path.join(REPO, 'data/manifest.json'))
const requested: string[] = []

function serveFromDisk() {
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url)
    const rel = url.slice(import.meta.env.BASE_URL.length)
    const file = path.join(REPO, rel)
    if (!fs.existsSync(file)) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    const body = fs.readFileSync(file)
    return new Response(body, { status: 200, headers: { 'content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream' } })
  })
}

describe.skipIf(!hasData)('data layer against data/ (DuckDB)', () => {
  beforeAll(async () => {
    setQueryEngine(await createNodeEngine())
    resetManifestCache()
    resetTables()
    resetScheduleCache()
    serveFromDisk()
  }, 60_000)
  afterAll(() => {
    vi.unstubAllGlobals()
    setQueryEngine(null)
  })

  it('loads the manifest and lazily fetches only the parquet a query needs', async () => {
    const m = await fetchManifest()
    expect(m.seasons.length).toBeGreaterThan(0)
    expect(requested.some((u) => u.endsWith('.parquet'))).toBe(false)
    const rows = await fetchTeamSeason({ season: m.current_season, team: 'KC' })
    expect(rows.map((r) => r.team).sort()).toEqual(['KC', 'NFL'])
    expect(typeof rows[0].off_epa_per_play).toBe('number')
    expect(typeof rows[0].season).toBe('number')
    expect(requested.filter((u) => u.endsWith('.parquet'))).toEqual([`${import.meta.env.BASE_URL}data/team_season.parquet`])
    await fetchTeamSeason({ season: m.current_season })
    expect(requested.filter((u) => u.endsWith('.parquet'))).toHaveLength(1) // registered once
  })

  it('team_week, tendencies, players', async () => {
    const m = await fetchManifest()
    const s = m.current_season
    const weeks = await fetchTeamWeek({ season: s, team: 'BAL' })
    expect(weeks.every((r) => r.team === 'BAL' && r.season === s)).toBe(true)
    expect(weeks.map((r) => r.week)).toEqual([...weeks.map((r) => r.week)].sort((a, b) => a - b))

    const t = await fetchTendencies({ season: s, teams: ['KC', 'NFL'], side: 'off', grouping: 'down_dist' })
    expect(t.length).toBeGreaterThan(0)
    expect(new Set(t.map((r) => r.team))).toEqual(new Set(['KC', 'NFL']))
    expect(t.every((r) => r.side === 'off' && r.grouping === 'down_dist')).toBe(true)
    expect(typeof t[0].low_sample).toBe('boolean')

    const qbs = await fetchPlayers({ season: s, position: 'QB' })
    expect(qbs.length).toBeGreaterThan(0)
    expect(qbs.every((r) => r.position === 'QB')).toBe(true)
  })

  it('schedule filters by season and week', async () => {
    const m = await fetchManifest()
    const games = await fetchSchedule({ season: m.current_season, week: m.current_week })
    expect(games.length).toBeGreaterThan(0)
    expect(games.every((g) => g.week === m.current_week)).toBe(true)
  })

  it('reports index and samples: 404 → [], otherwise arrays', async () => {
    const idx = await fetchReportsIndex()
    const samples = await fetchPlaycallerSamples()
    expect(Array.isArray(idx)).toBe(true)
    expect(Array.isArray(samples)).toBe(true)
    if (!fs.existsSync(path.join(REPO, 'reports/index.json'))) expect(idx).toEqual([])
  })
})

describe('404 handling', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reports index 404 → []; SPA html fallback → []', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    expect(await fetchReportsIndex()).toEqual([])
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect(await fetchPlaycallerSamples()).toEqual([])
  })
  it('other errors propagate', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }))
    await expect(fetchReportsIndex()).rejects.toThrow(/500/)
  })
})
