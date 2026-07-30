// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuardianActionOutbox } from '../data/database'
import {
  demoGuardianAlerts,
  demoGuardianParticipants,
} from '../domain/seed'
import { GuardianAlertQueue } from './GuardianAlertQueue'

afterEach(cleanup)

const handlers = () => ({
  onCheckIn: vi.fn(),
  onAcknowledge: vi.fn(),
  onResolve: vi.fn(),
  onRetry: vi.fn(),
  onDiscard: vi.fn(),
})

describe('GuardianAlertQueue', () => {
  it('requires a reason and submits explicit safety actions', async () => {
    const user = userEvent.setup()
    const events = handlers()
    render(
      <GuardianAlertQueue
        alerts={demoGuardianAlerts}
        participants={demoGuardianParticipants}
        pendingActions={[]}
        actionsEnabled
        {...events}
      />,
    )

    await user.click(screen.getByRole('button', {
      name: 'Check in Participant 7',
    }))
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))
    const resolve = screen.getByRole('button', { name: 'Resolve as safe' })
    expect(resolve).toBeDisabled()
    await user.type(
      screen.getByLabelText('Resolution reason'),
      'Participant returned to the safe area.',
    )
    await user.click(resolve)

    expect(events.onCheckIn).toHaveBeenCalledWith(
      demoGuardianParticipants[0].id,
    )
    expect(events.onAcknowledge).toHaveBeenCalledWith(
      demoGuardianAlerts[0].id,
    )
    expect(events.onResolve).toHaveBeenCalledWith(
      demoGuardianAlerts[0].id,
      'Participant returned to the safe area.',
    )
  })

  it('disables safety mutations outside an enrolled native app', () => {
    render(
      <GuardianAlertQueue
        alerts={demoGuardianAlerts}
        participants={demoGuardianParticipants}
        pendingActions={[]}
        actionsEnabled={false}
        {...handlers()}
      />,
    )

    expect(screen.getByText(/require the enrolled iOS or Android app/))
      .toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Check in Participant 7' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Acknowledge' }),
    ).toBeDisabled()
  })

  it('exposes recovery controls only after delivery fails', async () => {
    const user = userEvent.setup()
    const events = handlers()
    const failed: GuardianActionOutbox = {
      id: '592e64a5-a090-4f3c-a2bb-cd72862d92eb',
      kind: 'acknowledge',
      targetId: demoGuardianAlerts[0].id,
      reason: null,
      createdAt: '2026-07-30T18:30:00.000Z',
      attempts: 1,
      lastError: 'Not authorized.',
      nextAttemptAt: '2026-07-31T18:30:00.000Z',
    }
    render(
      <GuardianAlertQueue
        alerts={demoGuardianAlerts}
        participants={demoGuardianParticipants}
        pendingActions={[failed]}
        actionsEnabled
        {...events}
      />,
    )

    await user.click(screen.getByRole('button', {
      name: 'Retry Acknowledgement',
    }))
    await user.click(screen.getByRole('button', {
      name: 'Discard Acknowledgement',
    }))
    expect(events.onRetry).toHaveBeenCalledWith(failed.id)
    expect(events.onDiscard).toHaveBeenCalledWith(failed.id)
  })
})
