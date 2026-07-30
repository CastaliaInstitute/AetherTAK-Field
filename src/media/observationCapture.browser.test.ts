import { MediaType } from '@capacitor/camera'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteFile, inspect, writeFile } = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  inspect: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    deleteFile,
    readFile: vi.fn(),
    writeFile,
  },
}))

vi.mock('../platform/mediaIntegrity', () => ({
  mediaIntegrity: { inspect },
}))

import { persistCapturedMedia } from './observationCapture'

const capturedPhoto = {
  kind: 'photo' as const,
  media: {
    type: MediaType.Photo,
    webPath: 'blob:https://field.test/photo',
    saved: false,
  },
  coordinate: {
    latitude: 39.7411,
    longitude: -104.9949,
    altitudeMeters: 1_609,
    horizontalAccuracyMeters: 3,
    verticalAccuracyMeters: 5,
    headingDegrees: null,
  },
  capturedAt: '2026-07-30T06:00:00.000Z',
}

describe('browser media persistence', () => {
  beforeEach(() => {
    deleteFile.mockReset()
    inspect.mockReset()
    writeFile.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retains Web Crypto integrity for the persisted browser photo', async () => {
    const bytes = new TextEncoder().encode('browser-photo')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })),
    )
    writeFile.mockResolvedValue({ uri: 'capacitor://data/observations/photo.jpg' })

    const stored = await persistCapturedMedia(
      capturedPhoto,
      '87e11f1d-5fca-4dd5-b17c-5d8923beac50',
      'cd89c88b-85d5-47a1-8d79-bd1081d172b7',
    )

    expect(inspect).not.toHaveBeenCalled()
    expect(stored).toMatchObject({
      uri: 'capacitor://data/observations/photo.jpg',
      previewUri: capturedPhoto.media.webPath,
      mimeType: 'image/jpeg',
    })
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
