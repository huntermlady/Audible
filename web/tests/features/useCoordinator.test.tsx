import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildFactSheet, type GenerateResult, type Provider } from '@/ai'
import { useCoordinator } from '@/ai/useCoordinator'
import { sampleTendencies, SITUATION, validCall } from '../ai/helpers'

const result = (parsed: Record<string, unknown> | null): GenerateResult => ({
  rawText: JSON.stringify(parsed), parsed, latencyMs: 5, firstTokenMs: 2, promptTokens: 10, outputTokens: 20,
})

/** A fake Provider whose generateJson runs `impl`. */
function fakeProvider(impl: Provider['generateJson']): Provider {
  return { name: 'ollama', model: 'fake', generateJson: vi.fn(impl), streamText: async function* () {}, health: async () => ({ ok: true }) }
}

const tendencies = sampleTendencies()
const loadTendencies = async () => tendencies
const sheet = () => buildFactSheet({ kind: 'situation', situation: SITUATION }, { tendencies })

describe('useCoordinator', () => {
  it('starts idle, runs, and ends in success with first-token timing', async () => {
    const provider = fakeProvider(async (req) => {
      req.onToken?.('{')
      req.onToken?.('"role"')
      return result(validCall(sheet()))
    })
    const { result: hook } = renderHook(() => useCoordinator(provider, { loadTendencies }))
    expect(hook.current.state).toEqual({ status: 'idle', cancelled: false })

    act(() => hook.current.run(SITUATION))
    expect(hook.current.state.status).toBe('running')
    await waitFor(() => expect(hook.current.state.status).toBe('success'))
    const s = hook.current.state
    if (s.status !== 'success') throw new Error('expected success')
    expect(s.attempts).toBe(1)
    expect(s.call.primary.play_family).toBe('quick_pass')
    expect(s.factSheet.facts.length).toBeGreaterThan(1)
    expect(s.firstTokenMs).not.toBeNull()
    expect(s.situation).toEqual(SITUATION)
  })

  it('retries once, then reports the validation errors', async () => {
    const provider = fakeProvider(async () => result({ role: 'OC', nonsense: true }))
    const { result: hook } = renderHook(() => useCoordinator(provider, { loadTendencies }))
    act(() => hook.current.run(SITUATION))
    await waitFor(() => expect(hook.current.state.status).toBe('error'))
    const s = hook.current.state
    if (s.status !== 'error') throw new Error('expected error')
    expect(s.attempts).toBe(2)
    expect(provider.generateJson).toHaveBeenCalledTimes(2)
    expect(s.errors.length).toBeGreaterThan(0)
    expect(s.factSheet).not.toBeNull()
  })

  it('reports a tendency-load failure as an error, not a spinner', async () => {
    const provider = fakeProvider(async () => result(validCall(sheet())))
    const { result: hook } = renderHook(() => useCoordinator(provider, { loadTendencies: async () => Promise.reject(new Error('parquet 500')) }))
    act(() => hook.current.run(SITUATION))
    await waitFor(() => expect(hook.current.state.status).toBe('error'))
    expect(hook.current.state.status === 'error' && hook.current.state.errors).toEqual(['parquet 500'])
  })

  it('cancel aborts the in-flight request and returns to idle', async () => {
    let seenSignal: AbortSignal | undefined
    const provider = fakeProvider(
      (req) =>
        new Promise<GenerateResult>((_, reject) => {
          seenSignal = req.signal
          req.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const { result: hook } = renderHook(() => useCoordinator(provider, { loadTendencies }))
    act(() => hook.current.run(SITUATION))
    await waitFor(() => expect(provider.generateJson).toHaveBeenCalled())
    act(() => hook.current.cancel())
    expect(hook.current.state).toEqual({ status: 'idle', cancelled: true })
    expect(seenSignal?.aborted).toBe(true)
    // The rejected promise must not flip the state to error afterwards.
    await new Promise((r) => setTimeout(r, 10))
    expect(hook.current.state).toEqual({ status: 'idle', cancelled: true })
    expect(provider.generateJson).toHaveBeenCalledTimes(1)
  })

  it('settles to idle when the provider goes away mid-run (e.g. cloud quota used up)', async () => {
    const provider = fakeProvider(
      (req) =>
        new Promise<GenerateResult>((_, reject) => {
          req.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const { result: hook, rerender } = renderHook(({ p }: { p: Provider | null }) => useCoordinator(p, { loadTendencies }), { initialProps: { p: provider as Provider | null } })
    act(() => hook.current.run(SITUATION))
    await waitFor(() => expect(provider.generateJson).toHaveBeenCalled())
    rerender({ p: null })
    await waitFor(() => expect(hook.current.state).toEqual({ status: 'idle', cancelled: false }))
  })

  it('hides an error from a provider that went away (quota used up mid-request)', async () => {
    const quota = Object.assign(new Error('quota_exhausted'), { name: 'ProviderError' })
    const provider = fakeProvider(async () => {
      throw quota
    })
    const { result: hook, rerender } = renderHook(({ p }: { p: Provider | null }) => useCoordinator(p, { loadTendencies }), { initialProps: { p: provider as Provider | null } })
    act(() => hook.current.run(SITUATION))
    await waitFor(() => expect(hook.current.state.status).toBe('error'))
    rerender({ p: null }) // status flipped to sample
    expect(hook.current.state).toEqual({ status: 'idle', cancelled: false })
    rerender({ p: fakeProvider(async () => result(validCall(sheet()))) }) // live again later
    expect(hook.current.state.status).toBe('idle')
  })

  it('without a provider, reports an error instead of hanging', () => {
    const { result: hook } = renderHook(() => useCoordinator(null, { loadTendencies }))
    act(() => hook.current.run(SITUATION))
    expect(hook.current.state.status).toBe('error')
  })
})
