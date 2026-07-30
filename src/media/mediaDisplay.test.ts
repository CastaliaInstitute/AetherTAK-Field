import { describe, expect, it, vi } from 'vitest'
import type { MediaCapture, Observation } from '../domain/models'
import {
  artifactLabel,
  mediaDisplayUri,
  observationArtifacts,
} from './mediaDisplay'

const observation: Observation = {
  id: '87e11f1d-5fca-4dd5-b17c-5d8923beac50',
  fieldId: null,
  siteId: null,
  category: 'crop',
  title: 'Leaf damage',
  notes: '',
  coordinate: {
    latitude: 39.74,
    longitude: -104.99,
    altitudeMeters: null,
    horizontalAccuracyMeters: 3,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  observedAt: '2026-07-30T12:00:00.000Z',
  mediaIds: [
    'cd89c88b-85d5-47a1-8d79-bd1081d172b7',
    'f68d86e1-cb39-4517-bdaa-20b750839a92',
  ],
  syncState: 'queued',
}

const photo: MediaCapture = {
  id: observation.mediaIds[0],
  observationId: observation.id,
  kind: 'photo',
  localUri: 'file:///private/photo.jpg',
  previewUri: null,
  mimeType: 'image/jpeg',
  coordinate: observation.coordinate,
  capturedAt: observation.observedAt,
  deviceModel: null,
  sha256: null,
  depthMetadata: null,
  syncState: 'queued',
}

describe('offline evidence display', () => {
  it('converts native file URIs but leaves safe browser URIs intact', () => {
    const convert = vi.fn((uri: string) => `https://localhost/_file_/${uri}`)
    expect(mediaDisplayUri(photo.localUri, convert)).toContain('_file_')
    expect(convert).toHaveBeenCalledWith(photo.localUri)
    expect(mediaDisplayUri('blob:https://localhost/preview', convert)).toBe(
      'blob:https://localhost/preview',
    )
    expect(mediaDisplayUri('javascript:alert(1)', convert)).toBeNull()
    expect(mediaDisplayUri('https://localhost.evil/photo.jpg', convert)).toBeNull()
    expect(
      mediaDisplayUri('data:image/svg+xml;base64,PHN2Zz4=', convert),
    ).toBeNull()
  })

  it('preserves observation artifact order and exposes missing downloads', () => {
    expect(observationArtifacts(observation, [photo])).toEqual([
      { id: photo.id, media: photo },
      { id: observation.mediaIds[1], media: null },
    ])
  })

  it('uses operator-facing labels for depth artifacts', () => {
    expect(artifactLabel('point_cloud')).toBe('Point cloud')
    expect(artifactLabel('depth_confidence')).toBe('Depth confidence')
  })
})
