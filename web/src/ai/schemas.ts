// The CoordinatorCall schema for validation (ajv, full schema) and the model-facing version (refs
// inlined, unsupported keywords dropped, stat_ids constrained to the fact sheet's IDs). Mirrors
// ai/src/audible_ai/schemas.py. The browser only makes live calls; report bodies are generated and
// validated in Python, so the report schema is deliberately not bundled here.
import coordinatorCall from '@shared/schemas/coordinator_call.schema.json'

type Json = Record<string, unknown>

export const COORDINATOR_CALL_SCHEMA = coordinatorCall as Json

const STRIP = new Set([
  '$schema', '$id', '$defs', 'description', 'title', 'pattern', 'format',
  'minLength', 'maxLength', 'minimum', 'maximum', 'uniqueItems',
])

const byId = new Map<string, Json>([[COORDINATOR_CALL_SCHEMA.$id as string, COORDINATOR_CALL_SCHEMA]])

function resolve(ref: string, base: string, root: Json): [unknown, string] {
  const url = new URL(ref, base)
  const fragment = url.hash.replace(/^#/, '')
  url.hash = ''
  const docUrl = url.toString()
  let node: unknown = docUrl === (root.$id as string) ? root : byId.get(docUrl)
  if (node === undefined) throw new Error(`unknown schema ${docUrl}`)
  for (const part of fragment.split('/').filter(Boolean)) node = (node as Json)[part]
  return [node, docUrl]
}

/** Copy of `schema` with every $ref inlined and unsupported keywords removed. */
export function inlineSchema(schema: Json): Json {
  const walk = (node: unknown, base: string, root: Json): unknown => {
    if (Array.isArray(node)) return node.map((v) => walk(v, base, root))
    if (node === null || typeof node !== 'object') return node
    const obj = node as Json
    if (typeof obj.$ref === 'string') {
      const [target, targetBase] = resolve(obj.$ref, base, root)
      const targetRoot = targetBase === (root.$id as string) ? root : (byId.get(targetBase) ?? root)
      return walk(target, targetBase, targetRoot)
    }
    const out: Json = {}
    for (const [k, v] of Object.entries(obj)) {
      if (STRIP.has(k)) continue
      out[k] =
        k === 'properties'
          ? Object.fromEntries(Object.entries(v as Json).map(([name, sub]) => [name, walk(sub, base, root)]))
          : walk(v, base, root)
    }
    return out
  }
  return walk(schema, schema.$id as string, schema) as Json
}

function constrainStatIds(node: unknown, ids: string[]): void {
  if (Array.isArray(node)) return node.forEach((v) => constrainStatIds(v, ids))
  if (node === null || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node as Json)) {
    if (k === 'stat_ids' && v && typeof v === 'object' && (v as Json).type === 'array') {
      ;(v as Json).items = { type: 'string', enum: [...ids] }
    } else {
      constrainStatIds(v, ids)
    }
  }
}

const OC_ONLY = ['play_family', 'direction']
const DC_ONLY = ['front', 'coverage_shell', 'pressure']

/**
 * Pins the call's role and, in every call option, forces the other role's fields to null and this
 * role's required fields to non-null (the SPEC §12 role check, enforced by JSON mode). Mirrors
 * schemas.py `_constrain_role`; `direction` stays optional for the OC.
 */
function constrainRole(node: unknown, role: 'OC' | 'DC'): void {
  if (Array.isArray(node)) return node.forEach((v) => constrainRole(v, role))
  if (node === null || typeof node !== 'object') return
  const props = (node as Json).properties as Record<string, Json> | undefined
  if (props && 'role' in props && 'primary' in props) props.role = { type: 'string', enum: [role] }
  if (props && 'play_family' in props && 'front' in props) {
    for (const name of role === 'OC' ? DC_ONLY : OC_ONLY) props[name] = { type: 'null' }
    for (const name of role === 'OC' ? ['play_family'] : DC_ONLY) {
      const values = ((props[name].enum as unknown[]) ?? []).filter((v) => v !== null)
      props[name] = { type: 'string', enum: values }
    }
  }
  for (const v of Object.values(node as Json)) constrainRole(v, role)
}

/** Model-facing CoordinatorCall schema (SPEC §12); `role` pins the role's call fields. */
export function modelSchema(factIds: string[], role?: 'OC' | 'DC'): Json {
  const out = inlineSchema(COORDINATOR_CALL_SCHEMA)
  constrainStatIds(out, factIds)
  if (role) constrainRole(out, role)
  return out
}
