// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDeviceReadinessReport,
  type DatabaseMetrics,
} from '../device/readiness'
import { DeviceReadinessPanel } from './DeviceReadinessPanel'

const database: DatabaseMetrics = {
  records: {
    properties: 1,
    seasons: 1,
    fields: 1,
    ecologicalSites: 1,
    readings: 1,
    observations: 1,
    alerts: 0,
    insights: 1,
    guardianParticipants: 1,
    guardianAlerts: 1,
  },
  fieldQueue: { pending: 0, conflicts: 0, attemptedFailures: 0 },
  takQueue: { pending: 0, attemptedFailures: 0 },
  guardianQueue: { pending: 0, attemptedFailures: 0 },
  offlineMaps: {
    total: 1,
    ready: 1,
    partialOrFailed: 0,
    downloadedTiles: 30,
  },
  media: {
    total: 1,
    queued: 0,
    checksumEligible: 1,
    checksummed: 1,
    byKind: { photo: 1 },
  },
  synchronization: {
    cursor: 10,
    lastSyncAt: '2026-07-30T12:00:00.000Z',
  },
}

function report() {
  return buildDeviceReadinessReport({
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
      model: 'Pixel 10 Pro',
      platform: 'android',
      operatingSystem: 'android',
      osVersion: '16',
      manufacturer: 'Google',
      isVirtual: false,
      webViewVersion: '140',
    },
    storage: { usage: 104_857_600, quota: 2_000_000_000 },
    contactCount: 2,
    tak: {
      state: 'connected',
      profile: {
        id: 'profile-id',
        name: 'AetherTAK',
        host: 'tak.example.test',
        port: 8089,
        callsign: 'Field One',
        team: 'Green',
      },
      lastConnectedAt: '2026-07-30T12:04:00.000Z',
      error: null,
    },
    fieldApi: {
      state: 'healthy',
      httpStatus: 200,
    },
    backgroundTracking: {
      supported: true,
      enabled: false,
      detail: 'Background team location is off.',
    },
    depth: {
      supported: true,
      provider: 'arcore-depth',
      supportsPointCloud: true,
      supportsMesh: false,
      supportsConfidence: true,
      reason: null,
    },
    database,
  })
}

afterEach(cleanup)

describe('DeviceReadinessPanel', () => {
  it('collects, renders, and shares a sanitized readiness report', async () => {
    const user = userEvent.setup()
    const collect = vi.fn().mockResolvedValue(report())
    const share = vi.fn().mockResolvedValue('shared')
    render(
      <DeviceReadinessPanel
        contactCount={2}
        collect={collect}
        share={share}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Run readiness check' }),
    )

    expect(collect).toHaveBeenCalledWith(2)
    expect(screen.getByText('0.2.0 (42) · 0123456')).toBeInTheDocument()
    expect(screen.getByText('Pixel 10 Pro · 16')).toBeInTheDocument()
    expect(screen.getByText('TAK certificate enrollment')).toBeInTheDocument()
    expect(screen.getByText('Media integrity')).toBeInTheDocument()
    expect(screen.getByText('pass', { selector: '.readiness-overall' }))
      .toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Share JSON evidence' }),
    )
    expect(share).toHaveBeenCalledWith(report())
    expect(screen.getByRole('status')).toHaveTextContent(
      'Readiness evidence shared.',
    )
  })

  it('shows collection failures without creating misleading evidence', async () => {
    const user = userEvent.setup()
    render(
      <DeviceReadinessPanel
        contactCount={0}
        collect={vi.fn().mockRejectedValue(new Error('Native status failed.'))}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Run readiness check' }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Native status failed.',
    )
    expect(
      screen.queryByRole('button', { name: 'Share JSON evidence' }),
    ).not.toBeInTheDocument()
  })
})
