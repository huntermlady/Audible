import { fireEvent, render } from '@testing-library/react'
import { PointMark } from '@/components/charts'

const inSvg = (el: React.ReactNode) => render(<svg>{el}</svg>).container

describe('ScatterChart <PointMark> (pointImage)', () => {
  it('renders a centered 22px image when a URL is given', () => {
    const c = inSvg(<PointMark cx={100} cy={50} fill="var(--series-1)" image="https://example.test/kc.png" />)
    const img = c.querySelector('image')!
    expect(img).toHaveAttribute('href', 'https://example.test/kc.png')
    expect(img).toHaveAttribute('x', '89')
    expect(img).toHaveAttribute('y', '39')
    expect(img).toHaveAttribute('width', '22')
    expect(img).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
    expect(img).toHaveClass('team-logo')
    expect(c.querySelector('[data-point=circle]')).toBeNull()
  })

  it('falls back to the circle on null or a load error', () => {
    expect(inSvg(<PointMark cx={1} cy={1} fill="x" image={null} />).querySelector('[data-point=circle]')).not.toBeNull()
    const c = inSvg(<PointMark cx={1} cy={1} fill="x" image="https://example.test/broken.png" />)
    fireEvent.error(c.querySelector('image')!)
    expect(c.querySelector('image')).toBeNull()
    expect(c.querySelector('[data-point=circle]')).not.toBeNull()
  })

  it('rings highlighted images with the accent and fades muted ones', () => {
    const hi = inSvg(<PointMark cx={1} cy={1} fill="x" image="u" state="highlight" />)
    expect(hi.querySelector('g[data-state=highlight] circle')).toHaveAttribute('stroke', 'var(--accent)')
    const muted = inSvg(<PointMark cx={1} cy={1} fill="x" image="u" state="muted" />)
    expect(muted.querySelector('g[data-state=muted]')).toHaveAttribute('opacity', '0.45')
  })
})
