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
  clearPhysicalReleaseSession,
  createPhysicalReleaseSession,
  loadPhysicalReleaseSession,
  physicalReleaseVerdict,
  physicalReleaseChecks,
  recordDepthAccuracy,
  savePhysicalReleaseSession,
  updatePhysicalReleaseResult,
} from './evidence'

describe('physical release evidence', () => {
  beforeEach(() => {
    preference.clear()
    appInfo.mockResolvedValue({
      name: 'AetherTAK Field',
      id: 'org.castaliainstitute.aethertak.field',
      version: '0.2.0',
      build: '42',
    })
    deviceInfo.mockResolvedValue({
      platform: 'ios',
      model: 'iPhone 16 Pro',
      operatingSystem: 'ios',
      osVersion: '19.0',
      isVirtual: false,
    })
  })

  it('binds the complete physical matrix to the installed build and device', async () => {
    const session = await createPhysicalReleaseSession('RC-0.2.0/ios-lidar-01')

    expect(session.results).toHaveLength(physicalReleaseChecks.length)
    expect(session.release).toEqual(
      expect.objectContaining({
        appVersion: '0.2.0',
        build: '42',
      }),
    )
    expect(session.device).toEqual(
      expect.objectContaining({
        platform: 'ios',
        model: 'iPhone 16 Pro',
        isVirtual: false,
      }),
    )
    expect(JSON.stringify(session)).not.toContain('serverAddress')
    expect(JSON.stringify(session)).not.toContain('coordinate')
    expect(JSON.stringify(session)).not.toContain('testerName')
  })

  it('derives a pass or failure from known-dimension error and tolerance', async () => {
    let session = await createPhysicalReleaseSession('RC-0.2.0/ios-lidar-01')
    session = recordDepthAccuracy(
      session,
      {
        knownDistanceMeters: 2,
        measuredDistanceMeters: 2.08,
        tolerancePercent: 5,
      },
      'evidence/depth-ruler-01',
      'Controlled target.',
    )
    let result = session.results.find(
      (item) => item.check === 'depth_known_dimension',
    )
    expect(result).toEqual(
      expect.objectContaining({
        status: 'pass',
      }),
    )
    expect(result?.depthMeasurement?.absoluteErrorPercent).toBeCloseTo(4)

    session = recordDepthAccuracy(
      session,
      {
        knownDistanceMeters: 2,
        measuredDistanceMeters: 2.2,
        tolerancePercent: 5,
      },
      'evidence/depth-ruler-02',
      'Controlled target.',
    )
    result = session.results.find(
      (item) => item.check === 'depth_known_dimension',
    )
    expect(result?.status).toBe('fail')
  })

  it('completes only after every result has evidence or an N/A justification', async () => {
    let session = await createPhysicalReleaseSession('RC-0.2.0/android-01')
    for (const [check] of physicalReleaseChecks) {
      if (check === 'depth_known_dimension') {
        session = recordDepthAccuracy(
          session,
          {
            knownDistanceMeters: 1,
            measuredDistanceMeters: 1,
            tolerancePercent: 5,
          },
          'evidence/depth-01',
          '',
        )
      } else if (check === 'depth_fallback') {
        session = updatePhysicalReleaseResult(session, check, {
          status: 'not_applicable',
          evidenceReference: '',
          notes: '',
        })
        expect(session.completedAt).toBeNull()
        session = updatePhysicalReleaseResult(session, check, {
          status: 'not_applicable',
          evidenceReference: '',
          notes: 'Covered on companion unsupported-device session.',
        })
      } else {
        session = updatePhysicalReleaseResult(session, check, {
          status: 'pass',
          evidenceReference: `evidence/${check}`,
          notes: '',
        })
      }
    }
    expect(session.completedAt).not.toBeNull()
    expect(physicalReleaseVerdict(session)).toBe('attention')
    session = updatePhysicalReleaseResult(session, 'depth_fallback', {
      status: 'pass',
      evidenceReference: 'evidence/depth-fallback',
      notes: '',
    })
    expect(physicalReleaseVerdict(session)).toBe('pass')
  })

  it('rejects completed evidence from a virtual device or with a failed gate', async () => {
    deviceInfo.mockResolvedValueOnce({
      platform: 'android',
      model: 'Android SDK',
      operatingSystem: 'android',
      osVersion: '17',
      isVirtual: true,
    })
    let session = await createPhysicalReleaseSession('RC-0.2.0/emulator')
    for (const [check] of physicalReleaseChecks) {
      if (check === 'depth_known_dimension') {
        session = recordDepthAccuracy(
          session,
          {
            knownDistanceMeters: 1,
            measuredDistanceMeters: 1,
            tolerancePercent: 5,
          },
          'evidence/depth',
          '',
        )
      } else {
        session = updatePhysicalReleaseResult(session, check, {
          status: check === 'low_storage' ? 'fail' : 'pass',
          evidenceReference: `evidence/${check}`,
          notes: '',
        })
      }
    }
    expect(session.completedAt).not.toBeNull()
    expect(physicalReleaseVerdict(session)).toBe('fail')
  })

  it('persists and explicitly clears the active session', async () => {
    const session = await createPhysicalReleaseSession('RC-0.2.0/ios-01')
    await savePhysicalReleaseSession(session)
    expect(await loadPhysicalReleaseSession()).toEqual(session)
    await clearPhysicalReleaseSession()
    expect(await loadPhysicalReleaseSession()).toBeNull()
  })
})
