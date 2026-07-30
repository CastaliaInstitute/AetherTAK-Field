import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { MediaCapture, Observation } from '../domain/models'
import {
  captureGeotaggedPhoto,
  captureGeotaggedVideo,
  type GeotaggedMedia,
} from '../platform/capture'
import { currentDeviceModel } from '../platform/deviceMetadata'
import { mediaIntegrity } from '../platform/mediaIntegrity'
import { db, queueMutation } from '../data/database'

export interface ObservationCaptureInput {
  fieldId: string | null
  siteId: string | null
  category: Observation['category']
  title: string
  notes: string
}

interface StoredMedia {
  uri: string
  previewUri: string | null
  mimeType: string
  sha256: string | null
  cleanup: () => Promise<void>
}

export interface ObservationCaptureDependencies {
  capture: () => Promise<GeotaggedMedia>
  deviceModel: () => Promise<string | null>
  persist: (
    capture: GeotaggedMedia,
    observationId: string,
    mediaId: string,
  ) => Promise<StoredMedia>
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function persistCapturedMedia(
  capture: GeotaggedMedia,
  observationId: string,
  mediaId: string,
): Promise<StoredMedia> {
  const extension = capture.kind === 'video' ? 'mp4' : 'jpg'
  const mimeType = capture.kind === 'video' ? 'video/mp4' : 'image/jpeg'
  const path = `observations/${observationId}/${mediaId}.${extension}`
  const isNative = Capacitor.isNativePlatform()
  let data: string | Blob
  let browserBytes: ArrayBuffer | null = null

  if (
    capture.kind === 'video' &&
    isNative &&
    capture.media.uri
  ) {
    const uri = capture.media.uri
    const cleanup = async () => {
      await Filesystem.deleteFile({ path: uri })
    }
    try {
      const integrity = await mediaIntegrity.inspect(uri)
      return {
        uri,
        previewUri: capture.media.thumbnail
          ? `data:image/jpeg;base64,${capture.media.thumbnail}`
          : null,
        mimeType,
        sha256: integrity.sha256,
        cleanup,
      }
    } catch (error) {
      await cleanup().catch(() => undefined)
      throw error
    }
  }

  if (isNative && capture.media.uri) {
    const source = await Filesystem.readFile({ path: capture.media.uri })
    if (typeof source.data !== 'string') {
      throw new Error('Native camera returned an unsupported media payload.')
    }
    data = source.data
  } else if (capture.media.webPath) {
    const response = await fetch(capture.media.webPath)
    if (!response.ok) {
      throw new Error(`Captured media returned HTTP ${response.status}.`)
    }
    const blob = await response.blob()
    data = blob
    browserBytes = await blob.arrayBuffer()
  } else {
    throw new Error('The camera did not return readable media.')
  }

  const written = await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data,
    recursive: true,
  })
  const cleanup = async () => {
    await Filesystem.deleteFile({ path, directory: Directory.Data })
  }
  try {
    let digest: string
    if (isNative) {
      digest = (await mediaIntegrity.inspect(written.uri)).sha256
    } else {
      if (!browserBytes) {
        throw new Error('Captured media has no browser byte payload.')
      }
      digest = await sha256(browserBytes)
    }
    return {
      uri: written.uri,
      previewUri: isNative
        ? written.uri
        : capture.media.webPath ??
          (capture.media.thumbnail
            ? `data:image/jpeg;base64,${capture.media.thumbnail}`
            : written.uri),
      mimeType,
      sha256: digest,
      cleanup,
    }
  } catch (error) {
    await cleanup().catch(() => undefined)
    throw error
  }
}

const photoDependencies: ObservationCaptureDependencies = {
  capture: captureGeotaggedPhoto,
  deviceModel: currentDeviceModel,
  persist: persistCapturedMedia,
}

const videoDependencies: ObservationCaptureDependencies = {
  capture: captureGeotaggedVideo,
  deviceModel: currentDeviceModel,
  persist: persistCapturedMedia,
}

export async function captureObservationMedia(
  input: ObservationCaptureInput,
  dependencies: ObservationCaptureDependencies,
) {
  const [captured, deviceModel] = await Promise.all([
    dependencies.capture(),
    dependencies.deviceModel().catch(() => null),
  ])
  const observationId = crypto.randomUUID()
  const mediaId = crypto.randomUUID()
  const stored = await dependencies.persist(captured, observationId, mediaId)

  const observation: Observation = {
    id: observationId,
    siteId: input.siteId,
    fieldId: input.fieldId,
    category: input.category,
    title: input.title,
    notes: input.notes,
    coordinate: captured.coordinate,
    observedAt: captured.capturedAt,
    mediaIds: [mediaId],
    syncState: 'queued',
  }
  const media: MediaCapture = {
    id: mediaId,
    observationId,
    kind: captured.kind,
    localUri: stored.uri,
    previewUri: stored.previewUri,
    mimeType: stored.mimeType,
    coordinate: captured.coordinate,
    capturedAt: captured.capturedAt,
    deviceModel,
    sha256: stored.sha256,
    depthMetadata: null,
    syncState: 'queued',
  }

  try {
    await db.transaction(
      'rw',
      [db.observations, db.media, db.outbox, db.syncMetadata],
      async () => {
        await db.observations.add(observation)
        await db.media.add(media)
        await queueMutation({
          entityType: 'observation',
          entityId: observation.id,
          operation: 'create',
          payload: observation,
        })
        await queueMutation({
          entityType: 'media',
          entityId: media.id,
          operation: 'create',
          payload: media,
        })
      },
    )
  } catch (error) {
    await stored.cleanup().catch(() => undefined)
    throw error
  }

  return { observation, media }
}

export function captureObservationPhoto(
  input: ObservationCaptureInput,
  dependencies: ObservationCaptureDependencies = photoDependencies,
) {
  return captureObservationMedia(input, dependencies)
}

export function captureObservationVideo(
  input: ObservationCaptureInput,
  dependencies: ObservationCaptureDependencies = videoDependencies,
) {
  return captureObservationMedia(input, dependencies)
}
