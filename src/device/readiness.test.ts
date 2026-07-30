import { describe, expect, it, vi } from 'vitest'
import { Share } from '@capacitor/share'
import {
  buildDeviceReadinessReport,
  serializeDeviceReadiness,
  shareDeviceReadiness,
  type DatabaseMetrics,
} from './readiness'

vi.mock('@capacitor/share', () => ({
  Share: {
    canShare: vi.fn(),
    share: vi.fn(),
  },
}))

const database: DatabaseMetrics = {
  records: {
    properties: 1,
    seasons: 1,
    fields: 2,
    ecologicalSites: 1,
    readings: 4,
    observations: 2,
    alerts: 1,
    insights: 1,
  },
  fieldQueue: {
    pending: 0,
    conflicts: 0,
    attemptedFailures: 0,
  },
  takQueue: {
    pending: 0,
    attemptedFailures: 0,
  },
  offlineMaps: {
    total: 1,
    ready: 1,
    partialOrFailed: 0,
    downloadedTiles: 84,
  },
  media: {
    total: 4,
    queued: 0,
    checksumEligible: 4,
    checksummed: 4,
    byKind: { photo: 1, video: 1, depth: 1, point_cloud: 1 },
  },
  synchronization: {
    cursor: 42,
    lastSyncAt: '2026-07-30T12:00:00.000Z',
  },
}

function healthySnapshot() {
  return {
    generatedAt: '2026-07-30T12:05:00.000Z',
    sourceRevision: '0123456789abcdef',
    native: true,
    online: true,
    app: {
      name: 'AetherTAK Field',
      id: 'org.castaliainstitute.aethertak.field',
      version: '0.2.0',
      build: '42',
    },
    device: {
      name: 'Private device name',
      model: 'iPhone17,1',
      platform: 'ios' as const,
      operatingSystem: 'ios' as const,
      osVersion: '19.0',
      manufacturer: 'Apple',
      isVirtual: false,
      webViewVersion: '619.1',
    },
    storage: {
      usage: 125_000_000,
      quota: 2_000_000_000,
    },
    contactCount: 3,
    tak: {
      state: 'connected' as const,
      profile: {
        id: 'private-profile-id',
        name: 'AetherTAK',
        host: 'tak.example.test',
        port: 8089,
        callsign: 'Field One',
        team: 'Green',
      },
      lastConnectedAt: '2026-07-30T12:04:00.000Z',
      error: null,
    },
    backgroundTracking: {
      supported: true,
      enabled: true,
      detail: 'Background team location is active.',
    },
    depth: {
      supported: true,
      provider: 'arkit-lidar' as const,
      supportsPointCloud: true,
      supportsMesh: true,
      supportsConfidence: true,
      reason: null,
    },
    database,
  }
}

describe('device readiness evidence', () => {
  it('builds a passing report only when release-critical runtime checks pass', () => {
    const report = buildDeviceReadinessReport(healthySnapshot())

    expect(report.overall).toBe('pass')
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true)
    expect(report.app).toMatchObject({
      version: '0.2.0',
      build: '42',
      sourceRevision: '0123456789abcdef',
    })
    expect(report.runtime.contactCount).toBe(3)
  })

  it('fails browser or virtual-device evidence and unresolved conflicts', () => {
    const report = buildDeviceReadinessReport({
      ...healthySnapshot(),
      native: false,
      device: {
        ...healthySnapshot().device,
        platform: 'web',
        operatingSystem: 'unknown',
        isVirtual: true,
      },
      tak: {
        ...healthySnapshot().tak,
        state: 'not_enrolled',
        profile: null,
      },
      database: {
        ...database,
        fieldQueue: {
          pending: 1,
          conflicts: 1,
          attemptedFailures: 1,
        },
      },
    })

    expect(report.overall).toBe('fail')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'native-runtime', status: 'fail' }),
      expect.objectContaining({ id: 'physical-device', status: 'fail' }),
      expect.objectContaining({ id: 'tak-enrollment', status: 'fail' }),
      expect.objectContaining({ id: 'field-sync', status: 'fail' }),
    ]))
  })

  it('flags any photo video or depth artifact missing integrity metadata', () => {
    const report = buildDeviceReadinessReport({
      ...healthySnapshot(),
      database: {
        ...database,
        media: {
          ...database.media,
          checksummed: 3,
        },
      },
    })

    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'media-integrity',
      status: 'attention',
      detail: '3 of 4 evidence artifacts have SHA-256 metadata.',
    }))
  })

  it('omits personal device names, profile IDs, errors, and record contents', () => {
    const report = buildDeviceReadinessReport(healthySnapshot())
    const parsed = JSON.parse(serializeDeviceReadiness(report)) as Record<
      string,
      unknown
    >
    const serialized = JSON.stringify(parsed)

    expect(serialized).not.toContain('Private device name')
    expect(serialized).not.toContain('private-profile-id')
    expect(serialized).not.toContain('tak.example.test')
    expect(serialized).not.toContain('"error"')
    expect(serialized).not.toContain('"notes"')
    expect(serialized).not.toContain('"latitude"')
    expect(serialized).not.toContain('"longitude"')
  })

  it('shares the validated report as JSON text', async () => {
    vi.mocked(Share.canShare).mockResolvedValue({ value: true })
    vi.mocked(Share.share).mockResolvedValue({})
    const report = buildDeviceReadinessReport(healthySnapshot())

    await expect(shareDeviceReadiness(report)).resolves.toBe('shared')
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({
      title: 'AetherTAK Field 0.2.0 readiness',
      text: expect.stringContaining('"schemaVersion": 1'),
    }))
  })
})
