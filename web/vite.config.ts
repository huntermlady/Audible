/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { claudeDevProxy } from './vite-plugins/claude-proxy.ts'
import { copyRepoData, serveRepoData } from './vite-plugins/audible.ts'

const webRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(webRoot, '..')
const BASE = '/Audible/'

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss(), serveRepoData(repoRoot, BASE), copyRepoData(repoRoot), claudeDevProxy(repoRoot)],
  resolve: {
    alias: {
      '@': path.resolve(webRoot, 'src'),
      '@shared': path.resolve(repoRoot, 'shared'),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
  },
  preview: { port: 4173 },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
})
