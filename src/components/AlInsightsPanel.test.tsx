// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { demoInsights, demoReadings } from '../domain/seed'
import { AlInsightsPanel } from './AlInsightsPanel'

afterEach(cleanup)

describe('AlInsightsPanel', () => {
  it('shows provenance, expiry, and the read-only authority boundary', async () => {
    const user = userEvent.setup()
    const insight = {
      ...demoInsights[0],
      generatedAt: '2026-07-30T09:45:00.000Z',
      expiresAt: '2026-07-30T11:00:00.000Z',
    }
    const reading = {
      ...demoReadings[0],
      recordedAt: '2026-07-30T09:50:00.000Z',
    }
    render(
      <AlInsightsPanel
        insights={[insight]}
        readings={[reading]}
        now={new Date('2026-07-30T10:00:00.000Z')}
      />,
    )

    expect(screen.getByText(/Advisory · read only/i)).toBeInTheDocument()
    expect(screen.getByText('expires in 1 hour')).toBeInTheDocument()
    await user.click(screen.getByText(insight.title))
    expect(screen.getByText(insight.rationale)).toBeInTheDocument()
    expect(screen.getByText('Source evidence · 1/1 available'))
      .toBeInTheDocument()
    expect(screen.getByText(reading.label)).toBeInTheDocument()
    expect(screen.getByText(/cannot change field records/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('makes missing source evidence visible without inventing values', async () => {
    const user = userEvent.setup()
    const insight = {
      ...demoInsights[0],
      expiresAt: '2026-07-30T11:00:00.000Z',
    }
    render(
      <AlInsightsPanel
        insights={[insight]}
        readings={[]}
        now={new Date('2026-07-30T10:00:00.000Z')}
      />,
    )

    await user.click(screen.getByText(insight.title))
    expect(screen.getByText('Source evidence · 0/1 available'))
      .toBeInTheDocument()
    expect(screen.getByText(/not present on this device/)).toBeInTheDocument()
  })

  it('renders an explicit empty state after callers remove expired insights', () => {
    render(<AlInsightsPanel insights={[]} readings={[]} />)
    expect(screen.getByText(/Expired advice is removed automatically/))
      .toBeInTheDocument()
  })
})
