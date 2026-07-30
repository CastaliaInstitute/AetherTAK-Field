import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  fieldHealth: vi.fn(),
  fieldIdentity: vi.fn(),
  guardianAction: vi.fn(),
  getContacts: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
  registerPlugin: () => native,
}))

import { fieldApiTransport, takTransport } from './tak'

const validContact = {
  uid: 'peer-1',
  callsign: 'ATAK One',
  team: 'Green',
  coordinate: {
    latitude: 39.7408,
    longitude: -104.9937,
    altitudeMeters: 1608,
    horizontalAccuracyMeters: 4,
    verticalAccuracyMeters: 7,
    headingDegrees: 82,
  },
  staleAt: '2026-07-30T05:05:00.000Z',
}

describe('native TAK boundary', () => {
  beforeEach(() => {
    native.fieldHealth.mockReset()
    native.fieldIdentity.mockReset()
    native.guardianAction.mockReset()
    native.getContacts.mockReset()
  })

  it('drops malformed native contacts before they reach the map', async () => {
    native.getContacts.mockResolvedValue({
      contacts: [
        validContact,
        {
          ...validContact,
          uid: 'invalid-coordinate',
          coordinate: { ...validContact.coordinate, longitude: 181 },
        },
        {
          ...validContact,
          uid: 'invalid-stale',
          staleAt: 'not-a-time',
        },
      ],
    })

    await expect(takTransport.contacts()).resolves.toEqual([validContact])
  })

  it('performs a certificate-backed field service health check on the configured port', async () => {
    native.fieldHealth.mockResolvedValue({
      status: 200,
      body: { status: 'ok', time: '2026-07-30T12:00:00.000Z' },
    })

    await expect(fieldApiTransport.health()).resolves.toMatchObject({
      status: 200,
      body: { status: 'ok' },
    })
    expect(native.fieldHealth).toHaveBeenCalledWith({ port: 9443 })
  })

  it('strictly validates the authenticated Field identity and roles', async () => {
    native.fieldIdentity.mockResolvedValue({
      status: 200,
      body: {
        authenticated: true,
        commonName: 'Field Supervisor',
        permissions: {
          publisher: false,
          guardianCheckIn: true,
          guardianSupervisor: true,
        },
      },
    })

    await expect(fieldApiTransport.identity()).resolves.toEqual({
      authenticated: true,
      commonName: 'Field Supervisor',
      permissions: {
        publisher: false,
        guardianCheckIn: true,
        guardianSupervisor: true,
      },
    })
    expect(native.fieldIdentity).toHaveBeenCalledWith({ port: 9443 })

    native.fieldIdentity.mockResolvedValue({
      status: 200,
      body: {
        authenticated: true,
        commonName: 'Field Supervisor',
        permissions: {
          publisher: false,
          guardianCheckIn: true,
          guardianSupervisor: true,
        },
        certificate: 'must-not-cross-the-bridge',
      },
    })
    await expect(fieldApiTransport.identity()).rejects.toThrow()
  })

  it('keeps Guardian actions inside the certificate-backed native boundary', async () => {
    const action = {
      idempotencyKey: '592e64a5-a090-4f3c-a2bb-cd72862d92eb',
      kind: 'acknowledge',
      targetId: '2ef8e548-27f6-4faf-9c35-b536b4d30599',
      reason: null,
      occurredAt: '2026-07-30T18:30:00.000Z',
    }
    native.guardianAction.mockResolvedValue({
      status: 200,
      body: { accepted: true },
    })

    await expect(fieldApiTransport.guardianAction(action)).resolves.toMatchObject({
      status: 200,
    })
    expect(native.guardianAction).toHaveBeenCalledWith({
      port: 9443,
      action,
    })
  })
})
