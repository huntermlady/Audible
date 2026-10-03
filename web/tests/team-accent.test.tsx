import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { getTeamAccent, TeamAccentScope, useTeamAccent } from '@/design/useTeamAccent'

function Page({ team }: { team?: string }) {
  useTeamAccent(team)
  return null
}

function Scoped({ team }: { team?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useTeamAccent(team, ref)
  return <div ref={ref} data-testid="scoped" />
}

describe('useTeamAccent / TeamAccentScope', () => {
  it('sets the accent vars + class on <html> and reverts on unmount', () => {
    const root = document.documentElement
    const { rerender, unmount } = render(<Page team="KC" />)
    const a = getTeamAccent('KC')!
    expect(root).toHaveClass('team-accent')
    expect(root.style.getPropertyValue('--team-accent-light')).toBe(a.light.accent)
    expect(root.style.getPropertyValue('--team-accent-dark')).toBe(a.dark.accent)
    rerender(<Page team="GB" />)
    expect(root.style.getPropertyValue('--team-accent-light')).toBe(getTeamAccent('GB')!.light.accent)
    unmount()
    expect(root).not.toHaveClass('team-accent')
    expect(root.style.getPropertyValue('--team-accent-light')).toBe('')
  })

  it('unknown or missing team leaves the neutral accent', () => {
    render(<Page team="XXX" />)
    expect(document.documentElement).not.toHaveClass('team-accent')
    expect(getTeamAccent(undefined)).toBeUndefined()
  })

  it('applies to a ref instead of the document', () => {
    render(<Scoped team="kc" />)
    expect(screen.getByTestId('scoped')).toHaveClass('team-accent')
    expect(document.documentElement).not.toHaveClass('team-accent')
  })

  it('TeamAccentScope scopes the vars to its subtree', () => {
    render(
      <TeamAccentScope team="BAL" data-testid="scope">
        x
      </TeamAccentScope>,
    )
    const el = screen.getByTestId('scope')
    expect(el).toHaveClass('team-accent')
    expect(el.style.getPropertyValue('--team-accent-light')).toBe(getTeamAccent('BAL')!.light.accent)
  })
})
