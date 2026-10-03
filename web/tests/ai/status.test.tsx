import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AIStatusProvider, useAIStatus } from '@/ai'
import { SETTINGS_KEY } from '@/ai/status'

const CLOUD = 'https://audible-ai.example.workers.dev'

function Probe() {
  const ai = useAIStatus()
  return (
    <div>
      <span data-testid="state">{`${ai.status}|${ai.source}|${ai.provider?.name ?? '-'}|${ai.settings.mode}`}</span>
      <button onClick={() => ai.setSettings({ ...ai.settings, mode: 'off' })}>off</button>
    </div>
  )
}

describe('AIStatusProvider', () => {
  beforeEach(() => localStorage.clear())

  it('resolves auto → cloud when local is down, then honors mode changes', async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith(CLOUD)) return Response.json({ models: [{ name: 'm' }] })
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    render(
      <AIStatusProvider fetchImpl={f} cloudUrl={CLOUD}>
        <Probe />
      </AIStatusProvider>,
    )
    expect(screen.getByTestId('state').textContent).toBe('checking|null|-|auto')
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('live|cloud|cloud|auto'))
    act(() => screen.getByText('off').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('sample|null|-|off'))
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({ mode: 'off' })
  })

  it('migrates old saved settings without a mode to auto', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ baseUrl: 'http://localhost:11434', model: 'qwen3:8b' }))
    const f = vi.fn(async () => {
      throw new TypeError('down')
    }) as unknown as typeof fetch
    render(
      <AIStatusProvider fetchImpl={f} cloudUrl="">
        <Probe />
      </AIStatusProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('sample|null|-|auto'))
  })
})
