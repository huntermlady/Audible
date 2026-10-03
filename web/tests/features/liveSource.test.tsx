import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AIStatusValue, Provider } from '@/ai'
import { LiveSourceBadge, useLiveLostNotice } from '@/features/ai-output/source'

const toast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))

let status: Partial<AIStatusValue> = {}
vi.mock('@/ai', async (orig) => ({ ...(await orig<typeof import('@/ai')>()), useAIStatus: () => status }))

const provider = (name: Provider['name']): Provider => ({ name, model: 'm-1', generateJson: vi.fn(), streamText: async function* () {}, health: async () => ({ ok: true }) })

function Probe() {
  useLiveLostNotice()
  return <LiveSourceBadge />
}

describe('live AI source UI', () => {
  it('labels the cloud and local sources', () => {
    status = { status: 'live', source: 'cloud', provider: provider('cloud') }
    const { rerender } = render(<Probe />)
    expect(screen.getByLabelText('Live AI: Cloud AI, m-1')).toBeInTheDocument()
    status = { status: 'live', source: 'local', provider: provider('ollama') }
    rerender(<Probe />)
    expect(screen.getByLabelText('Live AI: Local model, m-1')).toBeInTheDocument()
  })

  it('announces a mid-session fall back to samples once, with the status hint', () => {
    toast.mockClear()
    status = { status: 'live', source: 'cloud', provider: provider('cloud') }
    const { rerender, container } = render(<Probe />)
    const hint = "Today's free live-AI allowance is used up — showing sample calls."
    status = { status: 'sample', source: null, provider: null, errorHint: hint }
    act(() => rerender(<Probe />))
    expect(toast).toHaveBeenCalledWith(hint, { id: 'audible-live-lost' })
    expect(container).toBeEmptyDOMElement() // no badge in sample mode
    act(() => rerender(<Probe />))
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the app simply starts in sample mode or re-checks', () => {
    toast.mockClear()
    status = { status: 'sample', source: null, provider: null }
    const { rerender } = render(<Probe />)
    status = { status: 'live', source: 'local', provider: provider('ollama') }
    rerender(<Probe />)
    status = { status: 'checking', source: null, provider: null }
    rerender(<Probe />)
    status = { status: 'sample', source: null, provider: null }
    rerender(<Probe />)
    expect(toast).not.toHaveBeenCalled()
  })
})
