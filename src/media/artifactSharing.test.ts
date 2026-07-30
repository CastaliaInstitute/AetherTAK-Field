import { describe, expect, it, vi } from 'vitest'
import type { MediaCapture, Observation } from '../domain/models'
import { createArtifactSharingClient } from './artifactSharing'

const observation = {
  id: '12cff24a-35b4-4f77-9c42-ecb8f8d5973d',
  fieldId: null,
  siteId: null,
  category: 'habitat',
  title: 'Bank surface',
  notes: 'Sensitive field note that must not enter the share sheet.',
  coordinate: {
    latitude: 39.741,
    longitude: -104.995,
    altitudeMeters: null,
    horizontalAccuracyMeters: 2.5,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  observedAt: '2026-07-30T12:00:00.000Z',
  mediaIds: ['e38806fc-568d-408c-aa05-7916eaa04f6f'],
  syncState: 'queued',
} satisfies Observation

const artifact = {
  id: observation.mediaIds[0],
  observationId: observation.id,
  kind: 'model',
  localUri: 'file:///private/observations/depth-surface.obj',
  previewUri: 'file:///private/observations/preview.jpg',
  mimeType: 'model/obj',
  coordinate: observation.coordinate,
  capturedAt: observation.observedAt,
  deviceModel: 'Pixel 10 Pro',
  sha256: 'a'.repeat(64),
  depthMetadata: null,
  syncState: 'queued',
} satisfies MediaCapture

function client(overrides: {
  native?: boolean
  systemCanShare?: boolean
} = {}) {
  const share = vi.fn(async (_options: {
    title: string
    text: string
    files: string[]
    dialogTitle: string
  }) => undefined)
  return {
    share,
    value: createArtifactSharingClient({
      isNative: () => overrides.native ?? true,
      canShare: async () => ({ value: overrides.systemCanShare ?? true }),
      share,
    }),
  }
}

describe('verified evidence sharing', () => {
  it('shares one verified local artifact without coordinates or notes', async () => {
    const { value, share } = client()

    expect(value.canShare(artifact)).toBe(true)
    await value.share(artifact, observation)

    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: '3D model · Bank surface',
      files: [artifact.localUri],
      dialogTitle: 'Open or share verified 3d model',
    }))
    const text = share.mock.calls[0]![0].text
    expect(text).toContain('Pixel 10 Pro')
    expect(text).toContain(artifact.sha256)
    expect(text).not.toContain('39.741')
    expect(text).not.toContain(observation.notes)
  })

  it.each([
    ['remote URI', { localUri: 'https://field.example/model.obj' }],
    ['data URI', { localUri: 'data:model/obj;base64,AA==' }],
    ['missing digest', { sha256: null }],
  ] as const)('rejects %s', async (_label, patch) => {
    const { value, share } = client()
    const unsafe = { ...artifact, ...patch } as MediaCapture

    expect(value.canShare(unsafe)).toBe(false)
    await expect(value.share(unsafe, observation)).rejects.toThrow(
      /checksum-verified files stored on this device/,
    )
    expect(share).not.toHaveBeenCalled()
  })

  it('rejects browser use and an unavailable system share sheet', async () => {
    const browser = client({ native: false })
    expect(browser.value.canShare(artifact)).toBe(false)
    await expect(
      browser.value.share(artifact, observation),
    ).rejects.toThrow(/stored on this device/)

    const unavailable = client({ systemCanShare: false })
    await expect(
      unavailable.value.share(artifact, observation),
    ).rejects.toThrow(/share sheet is unavailable/)
    expect(unavailable.share).not.toHaveBeenCalled()
  })
})
