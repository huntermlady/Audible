import { defineConfig, devices } from '@playwright/test'

// Local: runs against `npm run preview` (needs a prior `npm run build`) at http://localhost:4173/Audible/.
// Deployed: BASE_URL=https://huntermlady.github.io/Audible/ npm run e2e (no local server is started).
// E2E_PORT runs the preview on another port, e.g. when something else already holds 4173.
const REMOTE = process.env.BASE_URL
const PORT = Number(process.env.E2E_PORT ?? 4173)
const BASE_URL = (REMOTE ?? `http://localhost:${PORT}/Audible/`).replace(/\/*$/, '/')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true } },
  ],
  webServer: REMOTE
    ? undefined
    : {
        command: PORT === 4173 ? 'npm run preview' : `npx vite preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
})
