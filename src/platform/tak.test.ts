import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  getContacts: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
  registerPlugin: () => native,
}))

import { takTransport } from './tak'

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
})
