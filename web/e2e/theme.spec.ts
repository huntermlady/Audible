import { expect, gotoReady, test } from './fixtures'

const DARK = /\bdark\b/

test.describe('no-flash first paint', () => {
  // Block the app bundle so only the inline <head> script can have set the class.
  test.beforeEach(async ({ page }) => {
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort())
  })

  test('system dark → dark class before any app code runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('./')
    await expect(page.locator('html')).toHaveClass(DARK)
    await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'system')
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark')
  })

  test('system light → no dark class', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('./')
    await expect(page.locator('html')).not.toHaveClass(DARK)
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light')
  })

  test('stored choice beats the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => localStorage.setItem('audible.theme', 'dark'))
    await page.goto('./')
    await expect(page.locator('html')).toHaveClass(DARK)
    await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'dark')
  })
})

test('theme toggle cycles and persists across reload', async ({ page, consoleErrors }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await gotoReady(page, './', /dashboard/i)
  const html = page.locator('html')
  const toggle = page.getByRole('button', { name: /^Theme:/ })

  await expect(toggle).toHaveAccessibleName(/^Theme: System/)
  await expect(html).not.toHaveClass(DARK)

  await toggle.click() // system → light
  await expect(toggle).toHaveAccessibleName(/^Theme: Light/)
  await expect(html).not.toHaveClass(DARK)

  await toggle.click() // light → dark
  await expect(toggle).toHaveAccessibleName(/^Theme: Dark/)
  await expect(html).toHaveClass(DARK)
  expect(await page.evaluate(() => localStorage.getItem('audible.theme'))).toBe('dark')

  await page.reload()
  await expect(html).toHaveClass(DARK)
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveAccessibleName(/^Theme: Dark/)

  await page.getByRole('button', { name: /^Theme:/ }).click() // dark → system (light)
  await expect(html).not.toHaveClass(DARK)
  expect(consoleErrors).toEqual([])
})
