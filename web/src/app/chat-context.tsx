import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { ChatContext } from '@/types/generated'

export type { ChatContext }

/** `open` accepts a partial context; omitted nullable fields become null. */
export type ChatContextInput = Pick<ChatContext, 'page'> & Partial<Omit<ChatContext, 'page'>>

export interface ChatState {
  open(ctx?: ChatContextInput): void
  close(): void
  isOpen: boolean
  context?: ChatContext
}

const Ctx = createContext<ChatState | null>(null)

export function normalizeChatContext(ctx: ChatContextInput): ChatContext {
  return {
    page: ctx.page,
    team: ctx.team ?? null,
    opponent: ctx.opponent ?? null,
    game_id: ctx.game_id ?? null,
    situation: ctx.situation ?? null,
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)
  const [context, setContext] = useState<ChatContext | undefined>()
  const open = useCallback((ctx?: ChatContextInput) => {
    if (ctx) setContext(normalizeChatContext(ctx))
    setOpen(true)
  }, [])
  const close = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ open, close, isOpen, context }), [open, close, isOpen, context])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChat(): ChatState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChat must be used inside <ChatProvider>')
  return v
}
