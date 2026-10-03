import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd but pass their own `env` (with a mocked AI binding) to worker.fetch, so
// nothing here reaches Cloudflare.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-08-15' } })],
  test: { include: ['test/**/*.test.ts'] },
})
