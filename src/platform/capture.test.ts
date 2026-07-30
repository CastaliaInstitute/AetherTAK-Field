import { MediaType } from '@capacitor/camera'
import { describe, expect, it } from 'vitest'
import { cameraCaptureEvidence } from './capture'

describe('camera capture evidence', () => {
  it('keeps bounded portable metadata and excludes raw EXIF', () => {
    const evidence = cameraCaptureEvidence(
      {
        type: MediaType.Video,
        saved: false,
        metadata: {
          size: 12_345_678,
          duration: 7.25,
          resolution: '1920x1080',
          format: ' MP4 ',
          creationDate: '2026-07-30T05:59:52-06:00',
          exif: '{"GPSLatitude":39.7,"MakerNote":"private"}',
        },
      },
      '2026-07-30T11:59:50.000Z',
      '2026-07-30T12:00:00.000Z',
      '2026-07-30T11:59:51.000Z',
    )

    expect(evidence).toEqual({
      captureRequestedAt: '2026-07-30T11:59:50.000Z',
      captureCompletedAt: '2026-07-30T12:00:00.000Z',
      locationObservedAt: '2026-07-30T11:59:51.000Z',
      metadataCreatedAt: '2026-07-30T11:59:52.000Z',
      sizeBytes: 12_345_678,
      durationSeconds: 7.25,
      widthPixels: 1920,
      heightPixels: 1080,
      format: 'mp4',
    })
    expect(evidence).not.toHaveProperty('exif')
  })

  it('drops malformed optional camera metadata', () => {
    const evidence = cameraCaptureEvidence(
      {
        type: MediaType.Photo,
        saved: false,
        metadata: {
          size: -1,
          duration: Number.NaN,
          resolution: 'not-a-resolution',
          format: '../../raw value',
          creationDate: 'not-a-date',
        },
      },
      '2026-07-30T11:59:50.000Z',
      '2026-07-30T12:00:00.000Z',
      '2026-07-30T11:59:51.000Z',
    )

    expect(evidence).toMatchObject({
      metadataCreatedAt: null,
      sizeBytes: null,
      durationSeconds: null,
      widthPixels: null,
      heightPixels: null,
      format: null,
    })
  })
})
