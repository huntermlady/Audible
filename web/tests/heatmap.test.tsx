import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Heatmap } from '@/components/charts'

describe('<Heatmap highlight>', () => {
  it('outlines the cited cell and labels it', () => {
    render(
      <TooltipProvider>
        <Heatmap
          rows={['1st', '3rd']}
          cols={['short', 'long']}
          cells={[
            { row: '1st', col: 'short', value: 0.4, display: '40%' },
            { row: '3rd', col: 'long', value: 0.7, display: '70%' },
          ]}
          colorScale="sequential"
          highlight={{ row: '3rd', col: 'long' }}
        />
      </TooltipProvider>,
    )
    const cited = screen.getByLabelText('3rd, long: 70% (cited)')
    expect(cited).toHaveAttribute('data-cited', 'true')
    expect(cited.className).toMatch(/outline-solid/)
    expect(screen.getByLabelText('1st, short: 40%')).not.toHaveAttribute('data-cited')
  })
})
