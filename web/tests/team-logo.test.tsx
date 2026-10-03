import { fireEvent, render, screen } from '@testing-library/react'
import teams from '@shared/teams.json'
import { TeamLogo } from '@/components/team/TeamLogo'

const withLogo = (teams as Record<string, unknown>[]).find((t) => typeof t.logo_url === 'string')

describe('<TeamLogo>', () => {
  it('falls back to the monogram for an unknown team', () => {
    const { container } = render(<TeamLogo team="XXX" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('XXX')
  })

  it.skipIf(!withLogo)('renders a lazy, fixed-box <img> and falls back to the monogram on error', () => {
    const t = withLogo as { abbr: string; name: string; logo_url: string }
    const { container } = render(<TeamLogo team={t.abbr} size="md" />)
    const img = screen.getByRole('img', { name: `${t.name} logo` })
    expect(img).toHaveAttribute('src', t.logo_url)
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img.parentElement?.className).toMatch(/size-10/)
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent(t.abbr)
  })

  it('uses the monogram when the team has no logo_url', () => {
    const noLogo = (teams as Record<string, unknown>[]).find((t) => !t.logo_url) as { abbr: string } | undefined
    if (!noLogo) return
    const { container } = render(<TeamLogo team={noLogo.abbr} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
