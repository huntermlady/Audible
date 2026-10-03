// Renders shared/prompts templates; mirrors ai/src/audible_ai/prompts.py.
// Template format: `<!-- @system -->` … `<!-- @user -->` …; other HTML comments are dropped.
import dcPrinciplesMd from '@shared/prompts/_dc_principles.md?raw'
import ocPrinciplesMd from '@shared/prompts/_oc_principles.md?raw'
import rulesMd from '@shared/prompts/_rules.md?raw'
import chatMd from '@shared/prompts/chat.md?raw'
import dcReportMd from '@shared/prompts/dc_report.md?raw'
import dcSituationalMd from '@shared/prompts/dc_situational.md?raw'
import ocReportMd from '@shared/prompts/oc_report.md?raw'
import ocSituationalMd from '@shared/prompts/oc_situational.md?raw'
import type { FactSheet } from '@/types/generated'

const TEMPLATES = {
  oc_situational: ocSituationalMd,
  dc_situational: dcSituationalMd,
  oc_report: ocReportMd,
  dc_report: dcReportMd,
  chat: chatMd,
} as const

export type TemplateName = keyof typeof TEMPLATES

export interface RenderedPrompt {
  system: string
  user: string
}

const SYSTEM = '<!-- @system -->'
const USER = '<!-- @user -->'

const clean = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').trim()

function fill(text: string, values: Record<string, string>): string {
  let out = text
  for (const [key, value] of Object.entries(values)) out = out.split(`{{${key}}}`).join(value)
  return out
}

export function renderPrompt(name: TemplateName, values: Record<string, string>): RenderedPrompt {
  const raw = TEMPLATES[name]
  const body = raw.includes(SYSTEM) ? raw.slice(raw.indexOf(SYSTEM) + SYSTEM.length) : raw
  const cut = body.indexOf(USER)
  const system = cut >= 0 ? body.slice(0, cut) : body
  const user = cut >= 0 ? body.slice(cut + USER.length) : ''
  // `{{principles}}` follows the template's role prefix (oc_/dc_), as in prompts.py.
  const principles = name.startsWith('oc_') ? clean(ocPrinciplesMd) : name.startsWith('dc_') ? clean(dcPrinciplesMd) : ''
  const all = { rules: clean(rulesMd), principles, ...values }
  return { system: fill(clean(system), all), user: fill(clean(user), all) }
}

/** Compact one-line-per-fact rendering used in every prompt. */
export function renderFacts(fs: FactSheet | null): string {
  if (!fs || fs.facts.length === 0) return '(no facts available)'
  return fs.facts
    .map((f) => {
      const league = f.league_display !== null ? ` (league ${f.league_display})` : ''
      const low = f.low_sample ? ', LOW SAMPLE' : ''
      return `- ${f.id} | ${f.label} | ${f.display}${league} | n=${f.n}${low}`
    })
    .join('\n')
}

const json = (obj: unknown) => JSON.stringify(obj, null, 2)

export function situationalPrompt(fs: FactSheet): RenderedPrompt {
  if (fs.context.kind !== 'situation') throw new Error('situationalPrompt needs a situation fact sheet')
  const s = fs.context.situation
  return renderPrompt(s.role === 'OC' ? 'oc_situational' : 'dc_situational', {
    situation: json(s),
    derived: json(fs.derived),
    fact_sheet: renderFacts(fs),
  })
}

export function retryUser(user: string, errors: string[]): string {
  const listed = errors.slice(0, 20).map((e) => `- ${e}`).join('\n')
  return `${user}\n\nYour previous response failed validation:\n${listed}\n\nFix every error and return the corrected JSON only.`
}
