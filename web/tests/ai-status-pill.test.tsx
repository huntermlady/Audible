import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AIStatusValue } from '@/ai'
import { AIStatusPill, statusLabel } from '@/app/layout/AIStatusPill'

const state: { value: Partial<AIStatusValue> } = { value: {} }
vi.mock('@/ai', () => ({ useAIStatus: () => state.value }))

const base = (over: Partial<AIStatusValue>): Partial<AIStatusValue> => ({
  status: 'sample',
  source: null,
  cloudAvailable: true,
  provider: null,
  settings: { mode: 'auto', baseUrl: 'http://localhost:11434', model: 'qwen3:4b-instruct' },
  setSettings: vi.fn(),
  retry: vi.fn(),
  ...over,
})

describe('AIStatusPill', () => {
  it.each([
    ['live', 'local', 'Live · Local'],
    ['live', 'cloud', 'Live · Cloud'],
    ['live', null, 'Live'],
    ['sample', null, 'Sample'],
    ['checking', null, 'Checking AI'],
    ['error', null, 'AI error'],
  ] as const)('label: %s + %s → %s', (status, source, label) => {
    expect(statusLabel(status, source)).toBe(label)
  })

  it('shows the source, error hint, and saves the chosen mode', async () => {
    const user = userEvent.setup()
    state.value = base({ status: 'sample', errorHint: 'Today’s free live-AI allowance is used up — showing sample calls.' })
    render(<AIStatusPill />)
    await user.click(screen.getByRole('button', { name: /AI status: Sample/ }))
    expect(screen.getByTestId('ai-error-hint')).toHaveTextContent('allowance is used up')
    await user.click(screen.getByRole('radio', { name: /^Cloud:/ }))
    await user.click(screen.getByRole('button', { name: /Save AI settings/ }))
    expect(state.value.setSettings).toHaveBeenCalledWith({ mode: 'cloud', baseUrl: 'http://localhost:11434', model: 'qwen3:4b-instruct' })
    expect(state.value.retry).toHaveBeenCalled()
  })

  it('disables Cloud with a hint when the build has no cloud URL', async () => {
    const user = userEvent.setup()
    state.value = base({ status: 'live', source: 'local', cloudAvailable: false })
    render(<AIStatusPill />)
    await user.click(screen.getByRole('button', { name: /AI status: Live · Local/ }))
    expect(screen.getByRole('radio', { name: /^Cloud:/ })).toBeDisabled()
    expect(screen.getAllByText(/Cloud is unavailable in this build/).length).toBeGreaterThan(0)
  })
})
