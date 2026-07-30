// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfflineMapRegion, Property } from '../domain/models'

const { reconcileOfflineMapRegions } = vi.hoisted(() => ({
  reconcileOfflineMapRegions: vi.fn(),
}))

vi.mock('../maps/offlineRegions', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../maps/offlineRegions')>()
  return {
    ...original,
    reconcileOfflineMapRegions,
  }
})

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

const readyRegion: OfflineMapRegion = {
  id: '35760720-e9cc-489f-9190-c5c8b4ddf659',
  name: property.name,
  tileSourceId: source.id,
  bounds: {
    west: -104.991,
    south: 39.739,
    east: -104.989,
    north: 39.741,
  },
  minZoom: 12,
  maxZoom: 12,
  tileCount: 1,
  downloadedTiles: 1,
  status: 'ready',
  updatedAt: '2026-07-30T12:00:00.000Z',
}

afterEach(cleanup)

beforeEach(() => {
  reconcileOfflineMapRegions.mockReset()
  reconcileOfflineMapRegions.mockResolvedValue({
    regions: [],
    changedRegions: 0,
    evictedTiles: 0,
  })
})

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

  it('reports evicted tiles discovered during startup reconciliation', async () => {
    const onNotice = vi.fn()
    reconcileOfflineMapRegions.mockResolvedValueOnce({
      regions: [{
        ...readyRegion,
        downloadedTiles: 0,
        status: 'failed',
      }],
      changedRegions: 1,
      evictedTiles: 1,
    })

    render(
      <OfflineMapManager
        properties={[property]}
        regions={[readyRegion]}
        source={source}
        onNotice={onNotice}
        estimateStorage={async () => ({})}
      />,
    )

    await waitFor(() => {
      expect(reconcileOfflineMapRegions).toHaveBeenCalledWith(
        [readyRegion],
        source,
      )
      expect(onNotice).toHaveBeenCalledWith(
        expect.stringContaining('1 offline map tile was evicted'),
      )
    })
  })

  it('rechecks the cache inventory when the app becomes visible', async () => {
    render(
      <OfflineMapManager
        properties={[property]}
        regions={[readyRegion]}
        source={source}
        onNotice={vi.fn()}
        estimateStorage={async () => ({})}
      />,
    )
    await waitFor(() =>
      expect(reconcileOfflineMapRegions).toHaveBeenCalledTimes(1))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() =>
      expect(reconcileOfflineMapRegions).toHaveBeenCalledTimes(2))
  })

  it('blocks region actions while cache reconciliation is in flight', async () => {
    let finish:
      | ((value: {
          regions: OfflineMapRegion[]
          changedRegions: number
          evictedTiles: number
        }) => void)
      | undefined
    reconcileOfflineMapRegions.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve
      }),
    )
    const partial = {
      ...readyRegion,
      status: 'partial' as const,
      downloadedTiles: 0,
    }

    render(
      <OfflineMapManager
        properties={[property]}
        regions={[partial]}
        source={source}
        onNotice={vi.fn()}
        estimateStorage={async () => ({})}
      />,
    )

    expect(await screen.findByText('Verifying cached map tiles…'))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Resume ${partial.name}` }))
      .toBeDisabled()
    expect(screen.getByRole('button', { name: `Delete ${partial.name}` }))
      .toBeDisabled()

    await act(async () => {
      finish?.({
        regions: [partial],
        changedRegions: 0,
        evictedTiles: 0,
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('Verifying cached map tiles…'))
        .not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Resume ${partial.name}` }))
        .toBeEnabled()
    })
  })

  it('does not resume a region against a different configured source', async () => {
    const legacySourceRegion = {
      ...readyRegion,
      tileSourceId: 'retired-field-basemap',
      status: 'partial' as const,
      downloadedTiles: 0,
    }

    render(
      <OfflineMapManager
        properties={[property]}
        regions={[legacySourceRegion]}
        source={source}
        onNotice={vi.fn()}
        estimateStorage={async () => ({})}
      />,
    )

    expect(await screen.findByText('partial · source unavailable')).toBeVisible()
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: `Resume ${legacySourceRegion.name}`,
        }),
      ).toBeDisabled()
    })
    expect(
      screen.getByRole('button', {
        name: `Delete ${legacySourceRegion.name}`,
      }),
    ).toBeEnabled()
  })
})
