import { readFileSync } from 'node:fs'
import { test as base, expect, type ConsoleMessage, type Page } from '@playwright/test'

/** Every route the smoke and axe suites cover. Paths are relative to baseURL (…/Audible/). */
export const ROUTES = [
  { name: 'dashboard', path: './', h1: /dashboard/i },
  { name: 'team', path: 'team/KC', h1: /kansas city chiefs/i },
  // Resolved at run time to a game that exists in the served data (see resolveMatchup).
  { name: 'matchup', path: 'matchup:auto', h1: /./ },
  { name: 'play-caller', path: 'play-caller', h1: /play-caller/i },
  { name: 'players', path: 'players', h1: /players/i },
  { name: 'not-found', path: 'no-such-page', h1: /flag on the play/i },
] as const

export const THEMES = ['light', 'dark'] as const

export const REMOTE = !!process.env.BASE_URL

const OLLAMA = /^https?:\/\/(localhost|127\.0\.0\.1):11434\//

/**
 * The live-AI endpoints on any origin: local Ollama and the cloud Worker (CONTRACT_CHANGES #19),
 * whose URL is baked into the build from VITE_AI_CLOUD_URL, so match by path, not host.
 */
export const AI_API = (url: URL) => /\/api\/(tags|chat)$/.test(url.pathname)

export interface TeamRef {
  abbr: string
  name: string
  logo_url: string | null
  wordmark_url: string | null
}
export const TEAMS = JSON.parse(readFileSync(new URL('../../shared/teams.json', import.meta.url), 'utf8')) as TeamRef[]
/** Hotlinked team logos and wordmarks (CONTRACT_CHANGES #17). */
export const TEAM_IMAGE_URLS = new Set(TEAMS.flatMap((t) => [t.logo_url, t.wordmark_url]).filter((u): u is string => !!u))
/** 1×1 opaque PNG served in place of every team image, so no test depends on the CDN. */
export const STUB_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/**
 * Console errors that are expected and not bugs:
 * - the Ollama live-mode probe failing (it's down, blocked by us, or blocked by the browser);
 * - reports/index.json 404ing before the first real reports exist (the client reads it as []);
 * - on GitHub Pages, every deep link is served by 404.html with HTTP 404 (the SPA still renders).
 */
function isAllowed(msg: ConsoleMessage): boolean {
  const text = msg.text()
  const url = msg.location().url ?? ''
  if (text.includes('net::ERR_CONNECTION_REFUSED')) return true
  if (OLLAMA.test(url) || /(localhost|127\.0\.0\.1):11434/.test(text)) return true
  if (/status of 404/.test(text)) {
    if (/\/reports\/index\.json$/.test(url)) return true
    if (REMOTE && !/\.[a-z0-9]+$/i.test(new URL(url, 'http://x').pathname)) return true
  }
  return false
}

export interface Fixtures {
  /** Unexpected console errors and uncaught page errors, collected for the whole test. */
  consoleErrors: string[]
}

export const test = base.extend<Fixtures>({
  // Live AI is always "down" in e2e (local Ollama and the cloud Worker), even if one is reachable,
  // so every run sees sample mode. Specs that need live mode register their own routes on top.
  page: async ({ page }, provide) => {
    await page.route(AI_API, (route) => route.abort('connectionrefused'))
    await page.route((url) => TEAM_IMAGE_URLS.has(url.href), (route) => route.fulfill({ contentType: 'image/png', body: STUB_PNG }))
    await provide(page)
  },
  consoleErrors: [
    async ({ page }, provide) => {
      const errors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !isAllowed(msg)) errors.push(`console: ${msg.text()} (${msg.location().url})`)
      })
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
      await provide(errors)
    },
    { auto: true },
  ],
})

export { expect }

/** Sentinel path: the matchup page for a game that exists in the site's own data. */
export const MATCHUP = 'matchup:auto'

interface Game {
  game_id: string
  season: number
  week: number
  away_team: string
  home_team: string
}
let matchup: Promise<{ path: string; h1: RegExp }> | undefined

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const teamName = (abbr: string) => TEAMS.find((t) => t.abbr === abbr)?.name ?? abbr

/**
 * Picks a game from the served data, so the suite works on mock data, real data and the deployed
 * site: the newest current-season game with a game-plan report, else the first game of the current week.
 */
export function resolveMatchup(page: Page): Promise<{ path: string; h1: RegExp }> {
  matchup ??= (async () => {
    const json = async <T>(path: string, fallback: T): Promise<T> => {
      const res = await page.request.get(path)
      return res.ok() ? ((await res.json()) as T) : fallback
    }
    const [manifest, schedule, reports] = await Promise.all([
      json<{ current_season: number; current_week: number }>('data/manifest.json', { current_season: 0, current_week: 0 }),
      json<Game[]>('data/schedule.json', []),
      json<{ season: number; week: number; game_id: string }[]>('reports/index.json', []),
    ])
    const byId = new Map(schedule.map((g) => [g.game_id, g]))
    const reported = reports
      .filter((r) => r.season === manifest.current_season && byId.has(r.game_id))
      .sort((a, b) => b.week - a.week)[0]
    const game =
      (reported && byId.get(reported.game_id)) ??
      schedule.find((g) => g.season === manifest.current_season && g.week === manifest.current_week) ??
      schedule[0]
    if (!game) throw new Error('resolveMatchup: data/schedule.json has no games')
    return {
      path: `matchup/${game.season}/${game.week}/${game.game_id}`,
      h1: new RegExp(`${escape(teamName(game.away_team))} at ${escape(teamName(game.home_team))}`, 'i'),
    }
  })()
  return matchup
}

/** Loads a route and waits until its h1 is visible and every loading skeleton is gone. */
export async function gotoReady(page: Page, path: string, h1: RegExp) {
  if (path === MATCHUP) ({ path, h1 } = await resolveMatchup(page))
  const response = await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible()
  await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0)
  // Let late fetches (DuckDB range reads, the Ollama probe) finish so their errors are counted.
  await page.waitForLoadState('networkidle').catch(() => {})
  return response
}

/** Width the document overflows the viewport by, in CSS px (0 = no horizontal scroll). */
export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}
