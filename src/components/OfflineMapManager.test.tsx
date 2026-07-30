// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Property } from '../domain/models'
import { offlineMapStorageReserveBytes } from '../maps/offlineRegions'
import { OfflineMapManager } from './OfflineMapManager'

const property: Property = {
  id: '6ac343b4-4f16-4cae-bc78-e28043acd183',
  name: 'Aether Farm',
  description: '',
  center: {
    latitude: 39.74,
    longitude: -104.99,
    altitudeMeters: null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  boundary: [
    [-104.991, 39.739],
    [-104.989, 39.739],
    [-104.989, 39.741],
    [-104.991, 39.741],
  ],
  timezone: 'America/Denver',
  updatedAt: '2026-07-30T12:00:00.000Z',
  syncState: 'synced',
}

const source = {
  id: 'authorized-field-basemap',
  urlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
  attribution: 'Licensed field map',
  allowOfflineDownload: true,
}

afterEach(cleanup)

describe('OfflineMapManager', () => {
  it('blocks new regions and explains the reserve when storage is low', async () => {
    const estimateStorage = vi.fn(async () => ({
      usage: 950 * 1024 * 1024,
      quota: 1024 * 1024 * 1024,
    }))

    render(
      <OfflineMapManager
        properties={[property]}
        regions={[]}
        source={source}
        onNotice={vi.fn()}
        estimateStorage={estimateStorage}
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Download .* tiles/i }),
      ).toBeDisabled()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'keeps at least 100.0 MB available',
    )
    expect(estimateStorage).toHaveBeenCalledOnce()
    expect(screen.getByText('100.0 MB free-space reserve')).toBeVisible()
    expect(offlineMapStorageReserveBytes).toBe(100 * 1024 * 1024)
  })

  it('keeps downloading enabled when the reserve remains available', async () => {
    render(
      <OfflineMapManager
        properties={[property]}
        regions={[]}
        source={source}
        onNotice={vi.fn()}
        estimateStorage={async () => ({
          usage: 200 * 1024 * 1024,
          quota: 1024 * 1024 * 1024,
        })}
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Download .* tiles/i }),
      ).toBeEnabled()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
