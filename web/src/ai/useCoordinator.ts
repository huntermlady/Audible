// React wrapper around runCoordinatorCall (T4): situation → tendencies → fact sheet → provider →
// validate, with idle/running/success/error state, first-token timing, and cancel.
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTendencies } from '@/data/fetchers'
import type { CoordinatorCall, FactSheet, Situation, TeamTendencyRow } from '@/types/generated'
import { isAbortError, runCoordinatorCall } from './coordinator'
import { factSheetInputs } from './factsheet'
import { now, type Provider } from './providers/types'

export type CoordinatorState =
  | { status: 'idle'; cancelled: boolean }
  | { status: 'running'; situation: Situation; startedAt: number; firstTokenMs: number | null; chars: number }
  | {
      status: 'success'
      situation: Situation
      call: CoordinatorCall
      factSheet: FactSheet
      attempts: number
      latencyMs: number
      firstTokenMs: number | null
    }
  | { status: 'error'; situation: Situation; errors: string[]; factSheet: FactSheet | null; attempts: number }

/** Internal: an error remembers which provider produced it (see the derived state below). */
type InternalState = CoordinatorState | (Extract<CoordinatorState, { status: 'error' }> & { provider: Provider | null })

export interface UseCoordinatorOptions {
  /** Loads the tendency rows the fact sheet needs. Default: fetchTendencies via the data layer. */
  loadTendencies?: (situation: Situation) => Promise<TeamTendencyRow[]>
}

export interface UseCoordinator {
  state: CoordinatorState
  run(situation: Situation): void
  cancel(): void
  reset(): void
}

function defaultLoad(situation: Situation): Promise<TeamTendencyRow[]> {
  const { season, teams } = factSheetInputs({ kind: 'situation', situation })
  return fetchTendencies({ season, teams })
}

export function useCoordinator(provider: Provider | null, opts: UseCoordinatorOptions = {}): UseCoordinator {
  const [raw, setState] = useState<InternalState>({ status: 'idle', cancelled: false })
  const controller = useRef<AbortController | null>(null)
  const load = opts.loadTendencies ?? defaultLoad

  // Abort any in-flight request on unmount, or when the provider goes away mid-run (e.g. the cloud
  // quota ran out and the app fell back to sample mode). The run then settles to idle.
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (!provider) controller.current?.abort()
  }, [provider])

  const run = useCallback(
    (situation: Situation) => {
      controller.current?.abort()
      const ctrl = new AbortController()
      controller.current = ctrl
      const startedAt = now()
      const isCurrent = () => controller.current === ctrl && !ctrl.signal.aborted
      setState({ status: 'running', situation, startedAt, firstTokenMs: null, chars: 0 })

      if (!provider) {
        setState({ status: 'error', situation, errors: ['Live AI is not connected.'], factSheet: null, attempts: 0, provider: null })
        return
      }

      let firstToken: number | null = null
      let chars = 0
      const onToken = (t: string) => {
        if (!isCurrent()) return
        chars += t.length
        if (firstToken === null) firstToken = Math.round(now() - startedAt)
        const ft = firstToken
        const c = chars
        setState((s) => (s.status === 'running' ? { ...s, firstTokenMs: ft, chars: c } : s))
      }

      void (async () => {
        try {
          const tendencies = await load(situation)
          if (ctrl.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
          if (!isCurrent()) return
          const res = await runCoordinatorCall({ situation, tendencies, provider, signal: ctrl.signal, onToken })
          if (!isCurrent()) return
          controller.current = null
          setState(
            res.ok
              ? {
                  status: 'success',
                  situation,
                  call: res.call,
                  factSheet: res.factSheet,
                  attempts: res.attempts,
                  latencyMs: res.latencyMs,
                  firstTokenMs: res.firstTokenMs ?? firstToken,
                }
              : { status: 'error', situation, errors: res.errors, factSheet: res.factSheet, attempts: res.attempts, provider },
          )
        } catch (e) {
          if (isAbortError(e) || ctrl.signal.aborted) {
            // cancel() already cleared the controller and set the state; any other abort settles here.
            if (controller.current === ctrl) {
              controller.current = null
              setState({ status: 'idle', cancelled: false })
            }
            return
          }
          if (!isCurrent()) return
          controller.current = null
          setState({ status: 'error', situation, errors: [e instanceof Error ? e.message : String(e)], factSheet: null, attempts: 0, provider })
        }
      })()
    },
    [provider, load],
  )

  const cancel = useCallback(() => {
    const ctrl = controller.current
    if (!ctrl) return
    controller.current = null
    ctrl.abort()
    setState({ status: 'idle', cancelled: true })
  }, [])

  const reset = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setState({ status: 'idle', cancelled: false })
  }, [])

  // An error from a provider that has since gone away (e.g. the cloud quota ran out mid-request and
  // the app fell back to samples) is stale: it reads as idle rather than a raw provider error.
  let state: CoordinatorState = raw
  if (raw.status === 'error' && 'provider' in raw) {
    const { provider: from, ...rest } = raw
    state = from === provider ? rest : { status: 'idle', cancelled: false }
  }
  return { state, run, cancel, reset }
}
