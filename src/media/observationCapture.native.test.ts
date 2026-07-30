import { MediaType } from '@capacitor/camera'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { inspect, deleteFile, readFile, writeFile } = vi.hoisted(() => ({
  inspect: vi.fn(),
  deleteFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    deleteFile,
    readFile,
    writeFile,
  },
}))

vi.mock('../platform/mediaIntegrity', () => ({
  mediaIntegrity: { inspect },
}))

import { persistCapturedMedia } from './observationCapture'

const capturedVideo = {
  kind: 'video' as const,
  media: {
    type: MediaType.Video,
    uri: '/data/user/0/org.castaliainstitute.aethertak.field/files/videos/capture.mp4',
    thumbnail: 'dGh1bWJuYWls',
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

const capturedPhoto = {
  ...capturedVideo,
  kind: 'photo' as const,
  media: {
    type: MediaType.Photo,
    uri: '/data/user/0/org.castaliainstitute.aethertak.field/cache/camera/photo.jpg',
    webPath: 'http://localhost/_capacitor_file_/temporary-photo.jpg',
    saved: false,
  },
}

describe('native media persistence', () => {
  beforeEach(() => {
    inspect.mockReset()
    deleteFile.mockReset()
    readFile.mockReset()
    writeFile.mockReset()
  })

  it('streams integrity inspection before accepting persistent video', async () => {
    inspect.mockResolvedValue({
      sha256: 'b'.repeat(64),
      sizeBytes: 8_192,
    })

    const stored = await persistCapturedMedia(
      capturedVideo,
      '87e11f1d-5fca-4dd5-b17c-5d8923beac50',
      'cd89c88b-85d5-47a1-8d79-bd1081d172b7',
    )

    expect(inspect).toHaveBeenCalledWith(capturedVideo.media.uri)
    expect(stored).toMatchObject({
      uri: capturedVideo.media.uri,
      mimeType: 'video/mp4',
      sha256: 'b'.repeat(64),
      previewUri: 'data:image/jpeg;base64,dGh1bWJuYWls',
    })
    expect(deleteFile).not.toHaveBeenCalled()
    await stored.cleanup()
    expect(deleteFile).toHaveBeenCalledWith({
      path: capturedVideo.media.uri,
    })
  })

  it('removes an uncommitted capture when integrity inspection fails', async () => {
    inspect.mockRejectedValue(new Error('The captured media file is empty.'))

    await expect(
      persistCapturedMedia(
        capturedVideo,
        '87e11f1d-5fca-4dd5-b17c-5d8923beac50',
        'cd89c88b-85d5-47a1-8d79-bd1081d172b7',
      ),
    ).rejects.toThrow(/empty/)
    expect(deleteFile).toHaveBeenCalledWith({
      path: capturedVideo.media.uri,
    })
  })

  it('verifies the final private photo file and uses it for durable preview', async () => {
    const storedUri =
      'file:///data/user/0/org.castaliainstitute.aethertak.field/files/observations/photo.jpg'
    readFile.mockResolvedValue({ data: 'cGhvdG8=' })
    writeFile.mockResolvedValue({ uri: storedUri })
    inspect.mockResolvedValue({
      sha256: 'c'.repeat(64),
      sizeBytes: 2_048,
    })

    const stored = await persistCapturedMedia(
      capturedPhoto,
      '87e11f1d-5fca-4dd5-b17c-5d8923beac50',
      'cd89c88b-85d5-47a1-8d79-bd1081d172b7',
    )

    expect(inspect).toHaveBeenCalledWith(storedUri)
    expect(stored).toMatchObject({
      uri: storedUri,
      previewUri: storedUri,
      mimeType: 'image/jpeg',
      sha256: 'c'.repeat(64),
    })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('removes the private photo copy when final-file inspection fails', async () => {
    const observationId = '87e11f1d-5fca-4dd5-b17c-5d8923beac50'
    const mediaId = 'cd89c88b-85d5-47a1-8d79-bd1081d172b7'
    readFile.mockResolvedValue({ data: 'cGhvdG8=' })
    writeFile.mockResolvedValue({
      uri: 'file:///data/user/0/org.castaliainstitute.aethertak.field/files/observations/photo.jpg',
    })
    inspect.mockRejectedValue(new Error('The captured media file is empty.'))

    await expect(
      persistCapturedMedia(
        capturedPhoto,
        observationId,
        mediaId,
      ),
    ).rejects.toThrow(/empty/)
    expect(deleteFile).toHaveBeenCalledWith({
      path: `observations/${observationId}/${mediaId}.jpg`,
      directory: 'DATA',
    })
  })
})
