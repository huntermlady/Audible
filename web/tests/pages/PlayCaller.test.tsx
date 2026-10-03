import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AIStatusProvider } from '@/ai/status'
import { ChatProvider } from '@/app/chat-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { PlaycallerSample } from '@/types/generated'
import PlayCallerPage from '@/pages/PlayCaller'
import { readJson } from '../ai/helpers'

const samples = readJson<PlaycallerSample[]>('shared/fixtures/reports/samples/playcaller.json')

vi.mock('@/data', async (orig) => ({
  ...(await orig<typeof import('@/data')>()),
  useSeason: () => ({ season: 2026, seasons: [2026, 2025], setSeason: () => {} }),
  usePlaycallerSamples: () => ({ data: samples, error: null, isPending: false, isError: false, fetchStatus: 'idle', refetch: vi.fn() }),
  useTendencies: () => ({ data: undefined, error: null, isPending: true, isError: false, fetchStatus: 'idle', refetch: vi.fn() }),
}))

function renderPage() {
  // Ollama unreachable → sample mode.
  const offline = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AIStatusProvider fetchImpl={offline}>
        <TooltipProvider>
          <ChatProvider>
            <MemoryRouter>
              <PlayCallerPage />
            </MemoryRouter>
          </ChatProvider>
        </TooltipProvider>
      </AIStatusProvider>
    </QueryClientProvider>,
  )
}

describe('Play-Caller page', () => {
  it('shows a sample call with the banner when live AI is off', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText("Live AI runs on the owner's machine — this is a sample call.")).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Live AI is off' })).toBeDisabled()
    // Stat chips render fact display values.
    const fact = samples[0].fact_sheet.facts.find((f) => samples[0].call.rationale[0].stat_ids.includes(f.id))!
    expect(screen.getAllByRole('button', { name: new RegExp(`${fact.display.replace('+', '\\+')}\\. Show the underlying stat`) }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull()
  })

  it('shows inline validation errors as the user edits', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    const distance = screen.getByLabelText('Distance')
    const yardline = screen.getByLabelText('Yards to end zone')
    await user.clear(yardline)
    await user.type(yardline, '5')
    await user.clear(distance)
    await user.type(distance, '10')
    await user.tab()
    expect(await screen.findByText(/Distance can’t be more than the 5 yards/)).toBeInTheDocument()
    expect(distance).toHaveAttribute('aria-invalid', 'true')

    const clock = screen.getByLabelText('Clock (m:ss)')
    await user.clear(clock)
    await user.type(clock, '99')
    await user.tab()
    expect(await screen.findByText(/Enter the clock as m:ss/)).toBeInTheDocument()
  }, 15_000)

  it('picking a sample loads its situation into the form', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    const group = await screen.findByRole('group', { name: 'Sample calls' })
    const dc = samples.findIndex((s) => s.call.role === 'DC')
    await user.click(within(group).getAllByRole('button')[dc])
    expect(screen.getByLabelText('Yards to end zone')).toHaveValue(String(samples[dc].situation.yardline_100))
  }, 15_000)
})
