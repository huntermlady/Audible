import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Fact, FactSheet, FactSheetContext, Situation, TeamTendencyRow } from '@/types/generated'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const GOLDENS_DIR = path.join(REPO_ROOT, 'shared/factsheet/goldens')

export function goldenNames(): string[] {
  return readdirSync(GOLDENS_DIR)
    .filter((f) => f.endsWith('.expected.json'))
    .map((f) => f.replace(/\.expected\.json$/, ''))
    .sort()
}

export function loadGolden(name: string): { context: FactSheetContext; tendencies: TeamTendencyRow[]; expected: string } {
  const g = JSON.parse(readFileSync(path.join(GOLDENS_DIR, `${name}.json`), 'utf8'))
  return { context: g.context, tendencies: g.tendencies, expected: readFileSync(path.join(GOLDENS_DIR, `${name}.expected.json`), 'utf8') }
}

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8')) as T
}

export { existsSync }

export const SITUATION: Situation = {
  role: 'OC', offense: 'KC', defense: 'BAL', season: 2026, down: 3, distance: 7, yardline_100: 35,
  quarter: 4, clock_seconds: 110, score_diff: -4, timeouts_offense: 1, timeouts_defense: 2,
}

/** Tendency rows of the matchup golden (KC off / BAL def / NFL, 2026): enough for a situation sheet. */
export function sampleTendencies(): TeamTendencyRow[] {
  return loadGolden('matchup_oc_kc_bal_2026').tendencies
}

export function validCall(fs: FactSheet, role: 'OC' | 'DC' = 'OC') {
  const [f0, f1] = fs.facts as [Fact, Fact]
  const oc = role === 'OC'
  const opt = {
    play_family: oc ? 'quick_pass' : null,
    direction: oc ? 'right' : null,
    concept: oc ? 'Levels vs. expected pressure' : 'Cover 1 robber with a 5-man rush',
    front: oc ? null : 'odd',
    coverage_shell: oc ? null : 'cover1',
    pressure: oc ? null : 'blitz',
  }
  return {
    role,
    primary: opt,
    alternatives: [{ ...opt, concept: 'Screen away', when: 'If they show six at the line' }],
    rationale: [
      { text: `${f0.label} is ${f0.display}.`, stat_ids: [f0.id] },
      { text: `${f1.label} is ${f1.display}.`, stat_ids: [f1.id] },
    ],
    confidence: 'medium',
    caveats: [] as string[],
  }
}

/** Streamed Response from a list of string chunks. */
export function streamResponse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(body, init)
}
