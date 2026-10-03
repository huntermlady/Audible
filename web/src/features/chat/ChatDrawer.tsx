// Chat drawer contents (T4), rendered inside the T3 frame (src/app/layout/ChatDock.tsx), which
// supplies the title bar and close button; this component fills the remaining height.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertTriangle, ArrowUp, CircleStop, Eraser, MessageSquareDashed, Sparkles } from 'lucide-react'
import { buildChatSystem, buildFactSheet, chatFactSheetContext, factSheetInputs, isAbortError, type Provider } from '@/ai'
import { useChat, type ChatContext } from '@/app/chat-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fetchTendencies, useOptionalSeason } from '@/data'
import type { FactSheet } from '@/types/generated'
import { GroundedText } from '@/features/ai-output/GroundedText'
import { SampleBanner } from '@/features/ai-output/SampleBanner'
import { LiveSourceBadge, useLiveAI, useLiveLostNotice } from '@/features/ai-output/source'
import { clockText, DOWN_LABEL, quarterText } from '@/features/shared/format'
import { cn } from '@/lib/utils'

const GENERAL: ChatContext = { page: 'other', team: null, opponent: null, game_id: null, situation: null }

export default function ChatDrawer() {
  const { context } = useChat()
  const ctx = context ?? GENERAL
  // A new page context starts a new conversation.
  return <ChatSession key={JSON.stringify(ctx)} context={ctx} />
}

export function contextLabel(ctx: ChatContext): string {
  if (ctx.situation) {
    const s = ctx.situation
    return `${s.role} · ${s.offense} vs ${s.defense} · ${DOWN_LABEL[s.down]} & ${s.distance} · ${quarterText(s.quarter)} ${clockText(s.clock_seconds)}`
  }
  if (ctx.page === 'matchup' && ctx.team && ctx.opponent) return `Matchup · ${ctx.team} vs ${ctx.opponent}`
  if (ctx.page === 'team' && ctx.team) return `Team · ${ctx.team}`
  return 'General'
}

function suggestions(ctx: ChatContext): string[] {
  if (ctx.situation) {
    const s = ctx.situation
    return s.role === 'OC'
      ? [`What should ${s.offense} call here?`, `How does ${s.defense} defend this down and distance?`]
      : [`What will ${s.offense} likely do here?`, `Should ${s.defense} bring pressure?`]
  }
  if (ctx.page === 'matchup' && ctx.team && ctx.opponent) return [`How should ${ctx.team} attack the ${ctx.opponent} defense?`, `What must ${ctx.opponent} take away from ${ctx.team}?`]
  if (ctx.page === 'team' && ctx.team) return [`What does the ${ctx.team} offense like on 3rd & long?`, `Where is the ${ctx.team} defense vulnerable?`]
  return ['What makes a play successful by EPA?', 'What does PROE tell us about a team?']
}

interface Msg {
  id: number
  role: 'user' | 'assistant'
  content: string
  status: 'done' | 'streaming' | 'cancelled' | 'error'
  error?: string
  factSheet?: FactSheet | null
}

function ChatSession({ context }: { context: ChatContext }) {
  const { live, provider } = useLiveAI()
  useLiveLostNotice()
  const season = useOptionalSeason()?.season
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const controller = useRef<AbortController | null>(null)
  const factSheet = useRef<Promise<FactSheet | null> | null>(null)
  const nextId = useRef(1)
  const scroller = useRef<HTMLDivElement>(null)
  const streaming = messages.some((m) => m.status === 'streaming')

  const lost = useRef(false)
  useEffect(() => () => controller.current?.abort(), [])
  // Live AI went away mid-session (e.g. the cloud quota ran out): stop the stream and say why.
  useEffect(() => {
    if (!provider && controller.current) {
      lost.current = true
      controller.current.abort()
    }
  }, [provider])
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight })
  }, [messages])

  /** The fact sheet for this context, built once per conversation. */
  const loadFactSheet = useCallback((): Promise<FactSheet | null> => {
    if (season === undefined) return Promise.resolve(null)
    const fsCtx = chatFactSheetContext(context, season)
    if (!fsCtx) return Promise.resolve(null)
    factSheet.current ??= (async () => {
      const inputs = factSheetInputs(fsCtx)
      const tendencies = await fetchTendencies({ season: inputs.season, teams: inputs.teams })
      return buildFactSheet(fsCtx, { tendencies })
    })()
    factSheet.current.catch(() => (factSheet.current = null))
    return factSheet.current
  }, [context, season])

  const patch = (id: number, p: Partial<Msg>) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)))

  const send = async (text: string, provider: Provider) => {
    const question = text.trim()
    if (!question || streaming) return
    const history = messages.filter((m) => m.status === 'done' || m.role === 'user').map((m) => ({ role: m.role, content: m.content }))
    const userMsg: Msg = { id: nextId.current++, role: 'user', content: question, status: 'done' }
    const reply: Msg = { id: nextId.current++, role: 'assistant', content: '', status: 'streaming' }
    setMessages((ms) => [...ms, userMsg, reply])
    setDraft('')
    const ctrl = new AbortController()
    controller.current = ctrl
    lost.current = false
    const stopped = (): Partial<Msg> =>
      lost.current ? { status: 'error', error: CUT_SHORT, factSheet: fs } : { status: 'cancelled', factSheet: fs }
    let content = ''
    let fs: FactSheet | null = null
    try {
      fs = await loadFactSheet()
      const system = buildChatSystem(context, fs)
      for await (const chunk of provider.streamText({ system, messages: [...history, { role: 'user', content: question }], signal: ctrl.signal })) {
        if (ctrl.signal.aborted) break
        content += chunk
        patch(reply.id, { content })
      }
      // Grounding runs on the finished text (GroundedText); the stream itself isn't rejected.
      patch(reply.id, ctrl.signal.aborted ? stopped() : { status: 'done', content, factSheet: fs })
    } catch (e) {
      if (isAbortError(e) || ctrl.signal.aborted) patch(reply.id, stopped())
      else patch(reply.id, { status: 'error', error: e instanceof Error ? e.message : String(e), factSheet: fs })
    } finally {
      if (controller.current === ctrl) controller.current = null
    }
  }

  const cancel = () => controller.current?.abort()

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (provider) void send(draft, provider)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Badge variant="outline" className="max-w-full truncate font-mono text-[0.7rem]" title="Chat context">
          {contextLabel(context)}
        </Badge>
        <LiveSourceBadge className="shrink-0" />
        {messages.length > 0 && (
          <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => (cancel(), setMessages([]))} aria-label="Clear the conversation">
            <Eraser aria-hidden />
          </Button>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Conversation">
        {!live && (
          <SampleBanner title="Live AI runs on the owner's machine — chat is read-only here.">
            <p>
              Chat needs live AI (a local model or the cloud AI), which isn’t available right now. You can still read the pre-generated game plans on
              matchup pages and the sample calls in the Play-Caller.
            </p>
          </SampleBanner>
        )}

        {messages.length === 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MessageSquareDashed className="size-4" aria-hidden />
              {live ? 'Ask the coordinators about what you’re looking at.' : 'Example questions:'}
            </div>
            <ul className="space-y-2">
              {suggestions(context).map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    disabled={!live}
                    onClick={() => provider && void send(s, provider)}
                    aria-label={live ? `Ask: ${s}` : `Example question (chat is off): ${s}`}
                    className="w-full rounded-lg border border-dashed px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} context={context} live={live} />
        ))}
      </div>

      <form onSubmit={submit} className="border-t p-3" aria-label="Send a message">
        <div className={cn('flex items-end gap-2 rounded-lg border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/50', !live && 'opacity-60')}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!live || season === undefined}
            rows={2}
            placeholder={live ? 'Ask a question…' : 'Chat is off in sample mode'}
            aria-label="Message"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {streaming ? (
            <Button type="button" size="icon-sm" variant="destructive" onClick={cancel} aria-label="Stop generating">
              <CircleStop aria-hidden />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" variant="accent" disabled={!live || !draft.trim()} aria-label="Send message">
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[0.65rem] text-muted-foreground">
          Numbers not found in the data are <mark className="rounded-sm bg-warning/25 px-0.5 text-foreground underline decoration-warning decoration-wavy">highlighted</mark>.
        </p>
      </form>
    </div>
  )
}

const CUT_SHORT = 'live AI became unavailable, so this answer was cut short'

function MessageBubble({ msg, context, live }: { msg: Msg; context: ChatContext; live: boolean }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{msg.content}</p>
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground" aria-hidden>
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 text-sm">
        {msg.content ? (
          <p className="leading-relaxed whitespace-pre-wrap">
            {msg.status === 'streaming' ? msg.content : <GroundedText text={msg.content} factSheet={msg.factSheet ?? null} situation={context.situation} />}
            {msg.status === 'streaming' && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" aria-hidden />}
          </p>
        ) : msg.status === 'streaming' ? (
          <p className="text-muted-foreground">Thinking…</p>
        ) : null}
        {msg.status === 'cancelled' && <p className="text-xs text-muted-foreground">Stopped.</p>}
        {msg.status === 'error' && (
          <p className="flex items-start gap-1.5 text-xs text-critical" role="alert">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {live ? <>The model didn’t respond{msg.error ? `: ${msg.error}` : '.'}</> : <>The answer stopped: {CUT_SHORT}.</>}
          </p>
        )}
      </div>
    </div>
  )
}
