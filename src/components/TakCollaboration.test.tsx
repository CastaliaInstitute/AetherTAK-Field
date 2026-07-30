// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TakMapComposer,
  TakTeamPanel,
  TakTrackingControl,
} from './TakCollaboration'

const contact = {
  uid: 'field-two',
  callsign: 'Field Two',
  team: 'Green',
  coordinate: {
    latitude: 39.74,
    longitude: -104.99,
    altitudeMeters: null,
    horizontalAccuracyMeters: 3,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  staleAt: '2026-07-30T09:00:00.000Z',
}

afterEach(cleanup)

describe('TAK collaboration controls', () => {
  it('requires a connection to start background sharing and allows an active session to stop', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn(async () => undefined)
    const view = render(
      <TakTrackingControl
        status={{
          supported: true,
          enabled: false,
          detail: 'Background team position is off.',
        }}
        busy={false}
        connected={false}
        onToggle={onToggle}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Share in background' }),
    ).toBeDisabled()
    view.rerender(
      <TakTrackingControl
        status={{
          supported: true,
          enabled: true,
          detail: 'Team position is live.',
        }}
        busy={false}
        connected={false}
        onToggle={onToggle}
      />,
    )
    const stop = screen.getByRole('button', {
      name: 'Stop background sharing',
    })
    expect(stop).toBeEnabled()
    await user.click(stop)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('requires valid map geometry and a name before sending', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    const view = render(
      <TakMapComposer
        draft={{ kind: 'route', pointCount: 1 }}
        onStart={vi.fn()}
        onUndo={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    await user.type(screen.getByLabelText('Name'), 'Irrigation walk')
    expect(screen.getByRole('button', { name: 'Send to TAK' })).toBeDisabled()

    view.rerender(
      <TakMapComposer
        draft={{ kind: 'route', pointCount: 2 }}
        onStart={vi.fn()}
        onUndo={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Send to TAK' }))
    expect(onSubmit).toHaveBeenCalledWith('Irrigation walk', '')
  })

  it('composes an addressed GeoChat message', async () => {
    const user = userEvent.setup()
    const sendChat = vi.fn(async () => undefined)
    render(
      <TakTeamPanel
        callsign="Field One"
        contacts={[contact]}
        activity={[]}
        queuedCount={0}
        onSendChat={sendChat}
        onSendEmergency={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Message Field Two' }),
    )
    await user.type(
      screen.getByLabelText('Message to Field Two'),
      'Check bed four',
    )
    await user.click(screen.getByRole('button', { name: 'Send GeoChat' }))
    expect(sendChat).toHaveBeenCalledWith(contact, 'Check bed four')
  })

  it('uses an explicit confirmation before broadcasting an emergency', async () => {
    const user = userEvent.setup()
    const sendEmergency = vi.fn(async () => undefined)
    render(
      <TakTeamPanel
        callsign="Field One"
        contacts={[]}
        activity={[]}
        queuedCount={0}
        onSendChat={vi.fn()}
        onSendEmergency={sendEmergency}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Choose signal' }))
    expect(sendEmergency).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByLabelText('Emergency type'), 'Medical')
    await user.click(screen.getByRole('button', { name: 'Send Medical' }))
    expect(sendEmergency).toHaveBeenCalledWith('Medical')
  })
})
