import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { applyTheme, nextPreference, readStoredPreference, THEME_STORAGE_KEY, ThemeProvider, useTheme, writeStoredPreference } from '@/design/theme'
import { ThemeToggle } from '@/design/ThemeToggle'

function mockSystemDark(dark: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('dark') ? dark : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function Probe() {
  const { preference, resolved } = useTheme()
  return <output data-testid="probe">{`${preference}/${resolved}`}</output>
}

const renderApp = () =>
  render(
    <ThemeProvider>
      <TooltipProvider>
        <ThemeToggle />
        <Probe />
      </TooltipProvider>
    </ThemeProvider>,
  )

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  mockSystemDark(false)
})

describe('theme', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextPreference('system')).toBe('light')
    expect(nextPreference('light')).toBe('dark')
    expect(nextPreference('dark')).toBe('system')
  })

  it('persists the preference and restores it on the next mount (reload)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderApp()
    expect(screen.getByTestId('probe')).toHaveTextContent('system/light')
    await user.click(screen.getByRole('button', { name: /Theme: System/ }))
    await user.click(screen.getByRole('button', { name: /Theme: Light/ }))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    unmount()
    document.documentElement.className = ''
    renderApp()
    expect(screen.getByTestId('probe')).toHaveTextContent('dark/dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('system preference follows the OS', () => {
    mockSystemDark(true)
    renderApp()
    expect(screen.getByTestId('probe')).toHaveTextContent('system/dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('survives blocked storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readStoredPreference()).toBe('system')
    expect(() => writeStoredPreference('dark')).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })

  it('applyTheme sets class, color-scheme and data attribute', () => {
    act(() => {
      applyTheme('dark')
    })
    const root = document.documentElement
    expect(root).toHaveClass('dark')
    expect(root.style.colorScheme).toBe('dark')
    expect(root.dataset.themePref).toBe('dark')
  })

  it('index.html no-flash script uses the same storage key', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8')
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`)
  })
})
