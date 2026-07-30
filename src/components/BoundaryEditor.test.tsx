// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { BoundaryPoint } from '../domain/boundary'
import { BoundaryEditor } from './BoundaryEditor'

afterEach(cleanup)

function Harness({
  locate,
}: {
  locate?: () => Promise<{
    latitude: number
    longitude: number
    altitudeMeters: null
    horizontalAccuracyMeters: number
    verticalAccuracyMeters: null
    headingDegrees: null
  }>
}) {
  const [vertices, setVertices] = useState<BoundaryPoint[]>([])
  return (
    <BoundaryEditor
      vertices={vertices}
      onChange={setVertices}
      center={{ latitude: 40, longitude: -105 }}
      locate={locate}
    />
  )
}

describe('BoundaryEditor', () => {
  it('records GPS and manual vertices without silently closing an unfinished shape', async () => {
    const user = userEvent.setup()
    const locate = vi.fn().mockResolvedValue({
      latitude: 40,
      longitude: -105,
      altitudeMeters: null,
      horizontalAccuracyMeters: 3.7,
      verticalAccuracyMeters: null,
      headingDegrees: null,
    })
    render(<Harness locate={locate} />)

    await user.click(screen.getByRole('button', { name: 'Add current GPS vertex' }))
    expect(screen.getByText('1 vertices')).toBeInTheDocument()
    expect(screen.getByText('Last GPS fix ±4 m')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Vertex latitude'), '40.001')
    await user.type(screen.getByLabelText('Vertex longitude'), '-104.999')
    await user.click(screen.getByRole('button', { name: /^Add$/ }))

    expect(screen.getByText('2 vertices')).toBeInTheDocument()
    expect(screen.getByText(/Add at least three distinct/)).toBeInTheDocument()
  })

  it('creates an explicit one-hectare starter boundary and supports undo', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(
      screen.getByRole('button', { name: '100 m starter square' }),
    )
    expect(screen.getByText('4 vertices')).toBeInTheDocument()
    expect(screen.getByText('1.00 ha')).toBeInTheDocument()
    expect(screen.getByText('Closed polygon ready to save')).toBeInTheDocument()
    const polygon = screen
      .getByRole('img', { name: 'Boundary preview with 4 vertices' })
      .querySelector('polygon')
    expect(polygon).not.toBeNull()
    const points = (polygon?.getAttribute('points') ?? '')
      .split(' ')
      .map((point) => point.split(',').map(Number))
    const width = Math.max(...points.map((point) => point[0])) -
      Math.min(...points.map((point) => point[0]))
    const height = Math.max(...points.map((point) => point[1])) -
      Math.min(...points.map((point) => point[1]))
    expect(width).toBeCloseTo(height, 2)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('3 vertices')).toBeInTheDocument()
  })

  it('rejects out-of-range manual coordinates', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Vertex latitude'), '100')
    await user.type(screen.getByLabelText('Vertex longitude'), '-105')
    await user.click(screen.getByRole('button', { name: /^Add$/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid latitude and longitude.',
    )
  })
})
