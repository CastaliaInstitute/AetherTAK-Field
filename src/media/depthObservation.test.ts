import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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
    expect(result.observation.mediaIds).toHaveLength(3)
    expect(await db.observations.count()).toBe(1)
    expect(await db.media.count()).toBe(3)
    expect(await db.outbox.count()).toBe(4)
  })
})
