import { createOllamaProvider, DEFAULT_OLLAMA_URL, type OllamaOptions } from './ollama'
import type { Provider } from './types'

export { createOllamaProvider, DEFAULT_OLLAMA_URL, type OllamaOptions }
export * from './types'

/**
 * The dev-only Claude adapter (via the Vite `/__claude` proxy). Always null in production builds:
 * the DEV branch, including the dynamic import, is removed at build time.
 */
export async function loadDevClaudeProvider(model?: string): Promise<Provider | null> {
  if (import.meta.env.DEV) {
    const mod = await import('./claude-dev')
    return mod.createClaudeDevProvider(model)
  }
  return null
}

/** In dev, a model setting that starts with `claude-` selects the dev Claude adapter. */
export function isDevClaudeModel(model: string): boolean {
  if (import.meta.env.DEV) return model.startsWith('claude-')
  return false
}
