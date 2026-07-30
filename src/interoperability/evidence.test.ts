import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appInfo, deviceInfo, preference } = vi.hoisted(() => ({
  appInfo: vi.fn(),
  deviceInfo: vi.fn(),
  preference: new Map<string, string>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))
vi.mock('@capacitor/app', () => ({
  App: { getInfo: appInfo },
}))
vi.mock('@capacitor/device', () => ({
  Device: { getInfo: deviceInfo },
}))
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      preference.set(key, value)
    }),
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: preference.get(key) ?? null,
    })),
    remove: vi.fn(async ({ key }: { key: string }) => {
      preference.delete(key)
    }),
  },
}))
vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn() },
}))

import {
  clearInteroperabilitySession,
  createInteroperabilitySession,
  interoperabilityCapabilities,
  loadInteroperabilitySession,
  saveInteroperabilitySession,
  updateInteroperabilityLog,
  updateInteroperabilityResult,
} from './evidence'

describe('physical interoperability evidence', () => {
  beforeEach(() => {
    preference.clear()
    appInfo.mockResolvedValue({
      name: 'AetherTAK Field',
      id: 'org.castaliainstitute.aethertak.field',
      version: '0.2.0',
      build: '42',
    })
    deviceInfo.mockResolvedValue({
      model: 'iPhone 16 Pro',
      operatingSystem: 'ios',
      osVersion: '19.0',
    })
  })

  it('creates a complete bidirectional matrix without sensitive endpoint data', async () => {
    const session = await createInteroperabilitySession({
      peerClient: 'iTAK',
      peerVersion: '2.9',
      peerDeviceModel: 'iPhone 15',
      peerOsVersion: 'iOS 19',
      serverVersion: 'AetherTAK 1.0',
      senderCallsign: 'Field One',
      recipientCallsign: 'iTAK One',
    })

    expect(session.results).toHaveLength(
      interoperabilityCapabilities.length * 2,
    )
    expect(session.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'open_shape',
          direction: 'field_to_peer',
          status: 'pending',
        }),
        expect.objectContaining({
          capability: 'open_shape',
          direction: 'peer_to_field',
          status: 'pending',
        }),
      ]),
    )
    const serialized = JSON.stringify(session)
    expect(serialized).not.toContain('host')
    expect(serialized).not.toContain('coordinate')
    expect(serialized).not.toContain('message')
  })

  it('timestamps results, completion, and a bounded server-log interval', async () => {
    let session = await createInteroperabilitySession({
      peerClient: 'ATAK',
      peerVersion: '5.5',
      peerDeviceModel: 'Pixel 10',
      peerOsVersion: 'Android 17',
      serverVersion: 'AetherTAK 1.0',
      senderCallsign: 'Field One',
      recipientCallsign: 'ATAK One',
    })
    for (const result of session.results) {
      session = updateInteroperabilityResult(
        session,
        result.capability,
        result.direction,
        {
          status: 'pass',
          evidenceReference: `evidence/${result.capability}.png`,
          notes: '',
        },
      )
    }
    session = updateInteroperabilityLog(session, {
      startsAt: '2026-07-30T10:00:00.000Z',
      endsAt: '2026-07-30T10:15:00.000Z',
      reference: 'takserver/logs/session-42.txt',
    })
    expect(session.completedAt).not.toBeNull()
    expect(session.serverLogInterval.reference).toBe(
      'takserver/logs/session-42.txt',
    )
  })

  it('persists and explicitly clears the active session', async () => {
    const session = await createInteroperabilitySession({
      peerClient: 'ATAK',
      peerVersion: '5.5',
      peerDeviceModel: 'Pixel 10',
      peerOsVersion: 'Android 17',
      serverVersion: 'AetherTAK 1.0',
      senderCallsign: 'Field One',
      recipientCallsign: 'ATAK One',
    })
    await saveInteroperabilitySession(session)
    expect(await loadInteroperabilitySession()).toEqual(session)
    await clearInteroperabilitySession()
    expect(await loadInteroperabilitySession()).toBeNull()
  })
})
