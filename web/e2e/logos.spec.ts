import { expect, gotoReady, TEAM_IMAGE_URLS, TEAMS, test } from './fixtures'

// Team logos (CONTRACT_CHANGES #17) are hotlinked from shared/teams.json `logo_url` (ESPN CDN). The
// base fixture serves a stub PNG for every team image; the fallback test blocks them instead.
const KC = TEAMS.find((t) => t.abbr === 'KC')!

test('team logos render as images with alt text', async ({ page, consoleErrors }) => {
  expect(KC.logo_url, 'shared/teams.json KC.logo_url').toMatch(/^https:\/\//)
  await gotoReady(page, 'team/KC', /kansas city chiefs/i)

  const logo = page.locator(`img[src="${KC.logo_url}"]`).first()
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute('alt', /\S/)
  expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  expect(consoleErrors).toEqual([])
})

test('the monogram replaces a logo that fails to load', async ({ page }) => {
  await page.route((url) => TEAM_IMAGE_URLS.has(url.href), (route) => route.abort('blockedbyclient'))
  await gotoReady(page, 'team/KC', /kansas city chiefs/i)

  // No broken image is left on the page, and the KC monogram stands in for it.
  await expect(page.locator(`img[src="${KC.logo_url}"]`)).toHaveCount(0)
  await expect(page.getByTestId('team-monogram').filter({ hasText: /^KC$/ }).first()).toBeVisible()
})
