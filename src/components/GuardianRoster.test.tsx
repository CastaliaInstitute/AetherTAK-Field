// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { demoGuardianParticipants } from '../domain/seed'
import { GuardianRoster } from './GuardianRoster'

afterEach(cleanup)

describe('GuardianRoster', () => {
  it('shows safety context from offline participant state', () => {
    render(
      <GuardianRoster
        participants={demoGuardianParticipants}
        now={new Date(demoGuardianParticipants[0].updatedAt)}
      />,
    )

    expect(screen.getByText('Participant 7')).toBeInTheDocument()
    expect(screen.getByText(/Watch GPS/)).toBeInTheDocument()
    expect(screen.getByText(/72% battery/)).toBeInTheDocument()
    expect(screen.getByText(/does not provide medical diagnosis/)).toBeInTheDocument()
  })

  it('orders critical participants before normal participants', () => {
    const critical = {
      ...demoGuardianParticipants[0],
      id: '5ed41eb5-fb90-47f2-8918-b0e3af19e801',
      displayName: 'Critical Participant',
      state: 'critical' as const,
      alertState: 'sos' as const,
    }
    render(
      <GuardianRoster
        participants={[demoGuardianParticipants[0], critical]}
        now={new Date(critical.updatedAt)}
      />,
    )

    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Critical Participant',
      'Participant 7',
    ])
    expect(screen.getByText('sos')).toBeInTheDocument()
  })

  it('states clearly when no participant state is available', () => {
    render(<GuardianRoster participants={[]} now={new Date()} />)
    expect(screen.getByText(/No Guardian participant state/)).toBeInTheDocument()
  })
})
