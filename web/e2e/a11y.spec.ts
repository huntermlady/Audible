import AxeBuilder from '@axe-core/playwright'
import { expect, gotoReady, ROUTES, test, THEMES } from './fixtures'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// axe (WCAG 2.x A + AA, including color contrast) on every route in both themes, at both widths.
for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })

    for (const route of ROUTES) {
      test(`${route.name} has no WCAG AA violations`, async ({ page }) => {
        await gotoReady(page, route.path, route.h1)
        // Let enter animations settle so contrast is measured on final colors.
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
              .map((a) => a.finished.catch(() => {})),
          ),
        )

        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
        const summary = violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1).join('; ')}`),
          count: v.nodes.length,
        }))
        expect(summary).toEqual([])
      })
    }
  })
}
