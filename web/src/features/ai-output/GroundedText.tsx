import { Fragment, useMemo } from 'react'
import { checkGrounding } from '@/ai'
import type { FactSheet, Situation } from '@/types/generated'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export const NOT_FROM_DATA = 'Not from data: this number is not in the fact sheet'

/** Splits `text` at the ungrounded numeric tokens. Exported for tests. */
export function groundedSegments(text: string, fs: FactSheet | null, situation?: Situation | null): { text: string; ungrounded: boolean }[] {
  const { ungrounded } = checkGrounding(text, fs, situation)
  const out: { text: string; ungrounded: boolean }[] = []
  let at = 0
  for (const u of ungrounded) {
    if (u.start > at) out.push({ text: text.slice(at, u.start), ungrounded: false })
    out.push({ text: text.slice(u.start, u.end), ungrounded: true })
    at = u.end
  }
  if (at < text.length) out.push({ text: text.slice(at), ungrounded: false })
  return out
}

/** Model-written text with every ungrounded number highlighted and a "not from data" tooltip. */
export function GroundedText({ text, factSheet, situation }: { text: string; factSheet: FactSheet | null; situation?: Situation | null }) {
  const segments = useMemo(() => groundedSegments(text, factSheet, situation), [text, factSheet, situation])
  return (
    <>
      {segments.map((s, i) =>
        s.ungrounded ? (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <mark
                tabIndex={0}
                data-ungrounded
                aria-label={`${s.text} (not from data)`}
                className="cursor-help rounded-sm bg-warning/25 px-0.5 text-foreground underline decoration-warning decoration-wavy decoration-1 underline-offset-2"
              >
                {s.text}
              </mark>
            </TooltipTrigger>
            <TooltipContent>{NOT_FROM_DATA}</TooltipContent>
          </Tooltip>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  )
}
