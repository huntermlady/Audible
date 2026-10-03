import { expect, gotoReady, MATCHUP, REMOTE, test } from './fixtures'

test('a deep link loads directly and survives a reload', async ({ page, consoleErrors }) => {
  const response = await gotoReady(page, 'team/KC', /kansas city chiefs/i)
  // GitHub Pages answers deep links with 404.html (HTTP 404); vite preview falls back to index.html.
  expect(response?.status()).toBe(REMOTE ? 404 : 200)
  expect(new URL(page.url()).pathname).toBe('/Audible/team/KC')

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: /kansas city chiefs/i })).toBeVisible()
  expect(consoleErrors).toEqual([])
})

test('a nested deep link resolves assets and data under /Audible/', async ({ page, consoleErrors }) => {
  const bad: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.request().isNavigationRequest() && !/\/reports\/index\.json$/.test(r.url())) bad.push(`${r.status()} ${r.url()}`)
  })
  await gotoReady(page, MATCHUP, /./)
  expect(new URL(page.url()).pathname).toMatch(/^\/Audible\/matchup\/\d{4}\/\d+\/\w+$/)
  expect(bad).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('404.html is a copy of the app shell', async ({ request }) => {
  const [index, fallback] = await Promise.all([request.get('./'), request.get('404.html')])
  expect(fallback.status()).toBe(200)
  const body = await fallback.text()
  expect(body).toContain('<div id="root"></div>')
  expect(body).toBe(await index.text())
})

test('in-app navigation from a deep link keeps the base path', async ({ page }) => {
  await gotoReady(page, 'no-such-page', /flag on the play/i)
  await page.getByRole('link', { name: 'Back to the dashboard' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /dashboard/i })).toBeVisible()
  // React Router renders "/" under basename "/Audible" as "/Audible"; Pages redirects that to "/Audible/".
  expect(new URL(page.url()).pathname).toMatch(/^\/Audible\/?$/)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: /dashboard/i })).toBeVisible()
})

test('/Audible (no trailing slash) redirects to /Audible/', async ({ request, baseURL }) => {
  const res = await request.get(baseURL!.replace(/\/$/, ''), { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(new URL(res.headers()['location'], baseURL).pathname).toBe('/Audible/')
})
