// Validation pipeline (SPEC §12): schema → stat IDs exist → role fields → grounding.
// Mirrors ai/src/audible_ai/validate.py.
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import type { CoordinatorCall, FactSheet, Situation } from '@/types/generated'
import { checkGrounding } from './grounding'
import { COORDINATOR_CALL_SCHEMA } from './schemas'

const DC_FIELDS = ['front', 'coverage_shell', 'pressure'] as const

let compiled: ValidateFunction | null = null

function callValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    compiled = ajv.compile(COORDINATOR_CALL_SCHEMA)
  }
  return compiled
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath.replace(/^\//, '') || '(root)'}: ${e.message ?? 'invalid'}`)
}

function* callTexts(call: CoordinatorCall, where: string): Generator<[string, string]> {
  yield [`${where}primary.concept`, call.primary.concept]
  for (const [i, alt] of call.alternatives.entries()) {
    yield [`${where}alternatives/${i}.concept`, alt.concept]
    yield [`${where}alternatives/${i}.when`, alt.when]
  }
  for (const [i, item] of call.rationale.entries()) yield [`${where}rationale/${i}.text`, item.text]
  for (const [i, caveat] of call.caveats.entries()) yield [`${where}caveats/${i}`, caveat]
}

function* callStatIds(call: CoordinatorCall, where: string): Generator<[string, string]> {
  for (const [i, item] of call.rationale.entries()) for (const id of item.stat_ids) yield [`${where}rationale/${i}`, id]
}

function roleErrors(call: CoordinatorCall, role: 'OC' | 'DC', where: string): string[] {
  const errs: string[] = []
  if (call.role !== role) errs.push(`${where}role: expected '${role}', got '${call.role}'`)
  const options: [string, CoordinatorCall['primary']][] = [
    ['primary', call.primary],
    ...call.alternatives.map((alt, i): [string, CoordinatorCall['primary']] => [`alternatives/${i}`, alt]),
  ]
  for (const [name, opt] of options) {
    if (role === 'OC') {
      if (opt.play_family === null) errs.push(`${where}${name}.play_family: required for an OC call`)
      for (const f of DC_FIELDS) if (opt[f] !== null) errs.push(`${where}${name}.${f}: must be null for an OC call`)
    } else {
      if (opt.play_family !== null) errs.push(`${where}${name}.play_family: must be null for a DC call`)
      for (const f of DC_FIELDS) if (opt[f] === null) errs.push(`${where}${name}.${f}: required for a DC call`)
    }
  }
  return errs
}

function contentErrors(texts: [string, string][], statIds: [string, string][], fs: FactSheet, situation?: Situation | null): string[] {
  const known = new Set(fs.facts.map((f) => f.id))
  const errs = statIds.filter(([, id]) => !known.has(id)).map(([where, id]) => `${where}: unknown stat_id '${id}' (not in the fact sheet)`)
  for (const [where, text] of texts) {
    const r = checkGrounding(text, fs, situation)
    if (!r.grounded) {
      const tokens = r.ungrounded.map((u) => `'${u.token}'`).join(', ')
      errs.push(`${where}: ungrounded number(s) ${tokens}; use only numbers from the fact sheet display values or the situation`)
    }
  }
  return errs
}

function contextRole(fs: FactSheet): 'OC' | 'DC' {
  if (fs.context.kind === 'situation') return fs.context.situation.role
  if (fs.context.kind === 'matchup') return fs.context.role
  throw new Error('coordinator calls need a situation or matchup fact sheet')
}

export function validateCall(
  raw: unknown,
  fs: FactSheet,
  situation?: Situation,
): { ok: true; call: CoordinatorCall } | { ok: false; errors: string[] } {
  const v = callValidator()
  if (!v(raw)) return { ok: false, errors: formatErrors(v.errors) }
  const call = raw as CoordinatorCall
  const errors = [
    ...roleErrors(call, contextRole(fs), ''),
    ...contentErrors([...callTexts(call, '')], [...callStatIds(call, '')], fs, situation),
  ]
  return errors.length ? { ok: false, errors } : { ok: true, call }
}
