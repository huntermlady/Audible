// Situation → fact sheet → provider → validate → one retry with the errors appended (SPEC §12).
import type { CoordinatorCall, FactSheet, Situation, TeamTendencyRow } from '@/types/generated'
import { buildFactSheet } from './factsheet'
import { retryUser, situationalPrompt } from './prompts'
import { now, type Provider } from './providers/types'
import { modelSchema } from './schemas'
import { validateCall } from './validate'

export const MAX_ATTEMPTS = 2

export type CoordinatorResult =
  | { ok: true; call: CoordinatorCall; factSheet: FactSheet; attempts: number; latencyMs: number; firstTokenMs: number | null }
  | { ok: false; errors: string[]; factSheet: FactSheet; attempts: number }

export interface RunCoordinatorArgs {
  situation: Situation
  tendencies: TeamTendencyRow[]
  provider: Provider
  signal?: AbortSignal
  onToken?: (t: string) => void
}

function abortError(): Error {
  return typeof DOMException !== 'undefined'
    ? new DOMException('The operation was aborted.', 'AbortError')
    : Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/** Throws an AbortError when `signal` is aborted; any other provider failure counts as a failed attempt. */
export async function runCoordinatorCall(args: RunCoordinatorArgs): Promise<CoordinatorResult> {
  const { situation, tendencies, provider, signal, onToken } = args
  const factSheet = buildFactSheet({ kind: 'situation', situation }, { tendencies })
  const prompt = situationalPrompt(factSheet)
  const schema = modelSchema(
    factSheet.facts.map((f) => f.id),
    situation.role,
  )
  const start = now()
  let firstTokenMs: number | null = null
  let user = prompt.user
  let errors: string[] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError()
    try {
      const res = await provider.generateJson({ system: prompt.system, user, schema, signal, onToken })
      if (attempt === 1) firstTokenMs = res.firstTokenMs
      if (res.parsed === null) {
        errors = ['response is not a JSON object']
      } else {
        const v = validateCall(res.parsed, factSheet, situation)
        if (v.ok) {
          return { ok: true, call: v.call, factSheet, attempts: attempt, latencyMs: Math.round(now() - start), firstTokenMs }
        }
        errors = v.errors
      }
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw abortError()
      errors = [`provider error: ${e instanceof Error ? e.message : String(e)}`]
    }
    user = retryUser(prompt.user, errors)
  }
  return { ok: false, errors, factSheet, attempts: MAX_ATTEMPTS }
}
