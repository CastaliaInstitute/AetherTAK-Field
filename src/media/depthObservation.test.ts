import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../data/database'
import type { DepthScanResult } from '../domain/models'
import { captureDepthObservation } from './depthObservation'

const coordinate = {
  latitude: 39.7411,
  longitude: -104.9949,
  altitudeMeters: 1609,
  horizontalAccuracyMeters: 3,
  verticalAccuracyMeters: 5,
  headingDegrees: null,
}

const scan: DepthScanResult = {
  id: '3e3ed46b-290e-455a-a763-c59fab2a4321',
  provider: 'arcore-depth',
  capturedAt: '2026-07-30T06:00:00.000Z',
  coordinate,
  previewUri: 'file:///scan/preview.jpg',
  depthUri: 'file:///scan/depth.u16le',
  confidenceUri: 'file:///scan/confidence.u8',
  pointCloudUri: 'file:///scan/point-cloud.ply',
  modelUri: null,
  measurements: [
    { label: 'Median range', value: 1.7, unit: 'm', uncertainty: 0.04 },
  ],
}

describe('offline depth observation capture', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it('atomically queues depth, confidence, and point-cloud artifacts', async () => {
    const inspect = vi.fn(async (uri: string) => ({
      sha256: uri.includes('depth')
        ? 'a'.repeat(64)
        : uri.includes('confidence')
          ? 'b'.repeat(64)
          : 'c'.repeat(64),
      sizeBytes: 1_024,
    }))
    const cleanup = vi.fn(async () => undefined)
    const result = await captureDepthObservation(
      {
        fieldId: '28f77310-f12d-4fd5-8097-3387e83fd49f',
        siteId: null,
        category: 'crop',
        title: 'Canopy depth',
        notes: 'Structured depth evidence',
      },
      'point_cloud',
      {
        locate: async () => coordinate,
        scan: async () => scan,
        inspect,
        cleanup,
      },
    )

    expect(result.media.map((artifact) => artifact.kind)).toEqual([
      'depth',
      'depth_confidence',
      'point_cloud',
    ])
    expect(result.media[0].depthMetadata?.measurements).toEqual(
      scan.measurements,
    )
    expect(result.media.map((artifact) => artifact.sha256)).toEqual([
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
    ])
    expect(inspect).toHaveBeenCalledTimes(3)
    expect(cleanup).not.toHaveBeenCalled()
    expect(result.observation.mediaIds).toHaveLength(3)
    expect(await db.observations.count()).toBe(1)
    expect(await db.media.count()).toBe(3)
    expect(await db.outbox.count()).toBe(4)
  })

  it('removes the complete scan and commits nothing when integrity fails', async () => {
    const cleanup = vi.fn(async () => undefined)
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({
        sha256: 'a'.repeat(64),
        sizeBytes: 1_024,
      })
      .mockRejectedValueOnce(new Error('The confidence artifact is empty.'))

    await expect(
      captureDepthObservation(
        {
          fieldId: null,
          siteId: null,
          category: 'soil',
          title: 'Failed scan',
          notes: '',
        },
        'point_cloud',
        {
          locate: async () => coordinate,
          scan: async () => scan,
          inspect,
          cleanup,
        },
      ),
    ).rejects.toThrow(/empty/)

    expect(cleanup).toHaveBeenCalledWith([
      scan.previewUri,
      scan.depthUri,
      scan.confidenceUri,
      scan.pointCloudUri,
    ])
    expect(await db.observations.count()).toBe(0)
    expect(await db.media.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})
