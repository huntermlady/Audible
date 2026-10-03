import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_DEV_ADAPTER_MARKER } from '@/ai/providers/claude-dev'
import { existsSync, REPO_ROOT } from './helpers'

// Production bundles must contain neither the dev-only Claude adapter nor anything that talks to the
// Anthropic API directly. (The literal "claude-dev" is allowed: it is a GamePlanReport provider enum
// value in the shared schema.)
const DIST = path.join(REPO_ROOT, 'web/dist')
export const FORBIDDEN = ['/__claude', 'ANTHROPIC', 'x-api-key', 'anthropic-version', 'api.anthropic.com', CLAUDE_DEV_ADAPTER_MARKER]
const CODE_EXT = /\.(js|mjs|cjs|css|html|map)$/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

export function forbiddenHits(name: string, text: string): string[] {
  return FORBIDDEN.filter((needle) => text.includes(needle)).map((needle) => `${name}: ${needle}`)
}

describe('production bundle has no Claude dev code or secrets', () => {
  it('positive control: the grep catches the adapter marker and the proxy path', async () => {
    const src = readFileSync(path.join(REPO_ROOT, 'web/src/ai/providers/claude-dev.ts'), 'utf8')
    expect(forbiddenHits('claude-dev.ts', src)).toEqual(
      expect.arrayContaining([`claude-dev.ts: /__claude`, `claude-dev.ts: ${CLAUDE_DEV_ADAPTER_MARKER}`]),
    )
    // The marker survives into the module's runtime value, so a bundled adapter would be caught.
    const { createClaudeDevProvider } = await import('@/ai/providers/claude-dev')
    expect(forbiddenHits('runtime', JSON.stringify({ m: createClaudeDevProvider().adapterMarker }))).not.toEqual([])
    expect(forbiddenHits('enum', '{enum:[`ollama`,`claude`,`claude-dev`,`fake`]}')).toEqual([])
  })

  it.skipIf(!existsSync(DIST))('web/dist code contains none of the forbidden strings', () => {
    const code = files(DIST).filter((f) => CODE_EXT.test(f) && !/^(data|reports)[/\\]/.test(path.relative(DIST, f)))
    expect(code.length).toBeGreaterThan(0)
    const hits = code.flatMap((f) => forbiddenHits(path.relative(DIST, f), readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})
