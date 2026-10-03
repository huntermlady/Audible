import { expect, gotoReady, test } from './fixtures'

type Table = 'team_season' | 'team_week' | 'team_tendencies' | 'player_season'

// Each page fetches only the Parquet files it queries (BUILD_PLAN §2: "Parquet fetched lazily per page").
const CASES: { name: string; path: string; h1: RegExp; needs: Table[]; never: Table[] }[] = [
  { name: 'dashboard', path: './', h1: /dashboard/i, needs: ['team_season'], never: ['team_tendencies', 'player_season', 'team_week'] },
  { name: 'team', path: 'team/KC', h1: /kansas city chiefs/i, needs: ['team_tendencies'], never: ['player_season'] },
  { name: 'players', path: 'players', h1: /players/i, needs: ['player_season'], never: ['team_tendencies', 'team_week'] },
  { name: 'play-caller (sample mode)', path: 'play-caller', h1: /play-caller/i, needs: [], never: ['player_season', 'team_week'] },
]

for (const c of CASES) {
  test(`${c.name} fetches only the data it needs`, async ({ page }) => {
    const fetched = new Set<string>()
    page.on('request', (req) => {
      const m = /\/data\/([^/?]+)\.parquet(\?|$)/.exec(req.url())
      if (m) fetched.add(m[1])
    })
    await gotoReady(page, c.path, c.h1)

    const log = [...fetched].sort()
    for (const t of c.needs) expect(log, `${c.name} should fetch ${t}.parquet`).toContain(t)
    for (const t of c.never) expect(log, `${c.name} must not fetch ${t}.parquet`).not.toContain(t)
  })
}
