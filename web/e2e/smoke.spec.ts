import { expect, gotoReady, horizontalOverflow, ROUTES, test, THEMES } from './fixtures'

// Each route × {light, dark} (system preference, no stored choice) × {desktop, mobile} (projects).
for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })

    for (const route of ROUTES) {
      test(`${route.name} renders`, async ({ page, consoleErrors }, testInfo) => {
        await gotoReady(page, route.path, route.h1)

        const html = expect(page.locator('html'))
        await (theme === 'dark' ? html.toHaveClass(/\bdark\b/) : html.not.toHaveClass(/\bdark\b/))
        await expect(page.getByTestId('stats-as-of')).toContainText(/Stats as of \w/)

        if (testInfo.project.name === 'mobile') {
          expect(await horizontalOverflow(page), 'horizontal scroll at 375 px').toBeLessThanOrEqual(0)
        }
        expect(consoleErrors).toEqual([])
      })
    }
  })
}
