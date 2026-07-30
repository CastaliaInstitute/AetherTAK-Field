import 'fake-indexeddb/auto'
import { MediaType } from '@capacitor/camera'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/database'
import type { GeotaggedMedia } from '../platform/capture'
import {
  captureObservationMedia,
  type ObservationCaptureDependencies,
} from './observationCapture'

const coordinate = {
  latitude: 39.7411,
  longitude: -104.9949,
  altitudeMeters: 1609,
  horizontalAccuracyMeters: 3,
  verticalAccuracyMeters: 5,
  headingDegrees: null,
}

function dependencies(
  kind: GeotaggedMedia['kind'],
): ObservationCaptureDependencies {
  return {
    capture: async () => ({
      kind,
      media: {
        type: kind === 'photo' ? MediaType.Photo : MediaType.Video,
        saved: false,
      },
      coordinate,
      capturedAt: '2026-07-30T06:00:00.000Z',
    }),
    persist: async () => ({
      uri: `file:///data/evidence.${kind === 'photo' ? 'jpg' : 'mp4'}`,
      previewUri: null,
      mimeType: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
      sha256: 'a'.repeat(64),
      cleanup: async () => undefined,
    }),
  }
}

describe('offline observation media capture', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it.each(['photo', 'video'] as const)(
    'atomically persists a geotagged %s and two sync operations',
    async (kind) => {
      const result = await captureObservationMedia(
        {
          fieldId: '28f77310-f12d-4fd5-8097-3387e83fd49f',
          siteId: null,
          category: 'crop',
          title: `Field ${kind}`,
          notes: 'Structured evidence',
        },
        dependencies(kind),
      )

      expect(result.media.kind).toBe(kind)
      expect(result.media.coordinate).toEqual(coordinate)
      expect(result.media.sha256).toHaveLength(64)
      expect(result.observation.syncState).toBe('queued')
      expect(await db.media.count()).toBe(1)
      expect(await db.observations.count()).toBe(1)
      expect(await db.outbox.count()).toBe(2)
    },
  )
})
