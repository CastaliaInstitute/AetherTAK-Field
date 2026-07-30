import { Filesystem } from '@capacitor/filesystem'
import { db, queueMutation } from '../data/database'
import type {
  Coordinate,
  DepthScanResult,
  MediaCapture,
  Observation,
} from '../domain/models'
import { currentCoordinate } from '../platform/capture'
import { depthScanner } from '../platform/depth'
import {
  mediaIntegrity,
  type MediaIntegrityResult,
} from '../platform/mediaIntegrity'
import type { ObservationCaptureInput } from './observationCapture'

export type DepthScanMode = 'measure' | 'point_cloud' | 'mesh'

export interface DepthObservationDependencies {
  locate: () => Promise<Coordinate>
  scan: (
    coordinate: Coordinate,
    mode: DepthScanMode,
  ) => Promise<DepthScanResult>
  inspect: (uri: string) => Promise<MediaIntegrityResult>
  cleanup: (uris: string[]) => Promise<void>
}

const nativeDependencies: DepthObservationDependencies = {
  locate: currentCoordinate,
  scan: depthScanner.scan,
  inspect: mediaIntegrity.inspect,
  cleanup: async (uris) => {
    await Promise.allSettled(
      uris.map((uri) => Filesystem.deleteFile({ path: uri })),
    )
  },
}

export async function captureDepthObservation(
  input: ObservationCaptureInput,
  mode: DepthScanMode,
  dependencies: DepthObservationDependencies = nativeDependencies,
) {
  const coordinate = await dependencies.locate()
  const scan = await dependencies.scan(coordinate, mode)
  const observationId = crypto.randomUUID()

  const artifacts: Array<{
    kind: MediaCapture['kind']
    role: NonNullable<MediaCapture['depthMetadata']>['role']
    uri: string
    previewUri: string | null
    mimeType: string
  }> = [
    {
      kind: 'depth',
      role: 'depth',
      uri: scan.depthUri,
      previewUri: scan.previewUri,
      mimeType:
        scan.provider === 'arkit-lidar'
          ? 'application/x-aether-depth-f32le'
          : 'application/x-aether-depth-u16le',
    },
  ]
  if (scan.confidenceUri) {
    artifacts.push({
      kind: 'depth_confidence',
      role: 'confidence',
      uri: scan.confidenceUri,
      previewUri: null,
      mimeType: 'application/x-aether-depth-confidence',
    })
  }
  if (scan.pointCloudUri) {
    artifacts.push({
      kind: 'point_cloud',
      role: 'point_cloud',
      uri: scan.pointCloudUri,
      previewUri: scan.previewUri,
      mimeType: 'model/ply',
    })
  }
  if (scan.modelUri) {
    artifacts.push({
      kind: 'model',
      role: 'model',
      uri: scan.modelUri,
      previewUri: scan.previewUri,
      mimeType: 'model/obj',
    })
  }

  const cleanupUris = [
    ...new Set([scan.previewUri, ...artifacts.map((artifact) => artifact.uri)]),
  ]
  try {
    const media: MediaCapture[] = []
    for (const artifact of artifacts) {
      const integrity = await dependencies.inspect(artifact.uri)
      media.push({
        id: crypto.randomUUID(),
        observationId,
        kind: artifact.kind,
        localUri: artifact.uri,
        previewUri: artifact.previewUri,
        mimeType: artifact.mimeType,
        coordinate: scan.coordinate,
        capturedAt: scan.capturedAt,
        deviceModel: null,
        sha256: integrity.sha256,
        depthMetadata: {
          scanId: scan.id,
          provider: scan.provider,
          role: artifact.role,
          measurements: artifact.role === 'depth' ? scan.measurements : [],
        },
        syncState: 'queued',
      })
    }
    const observation: Observation = {
      id: observationId,
      siteId: input.siteId,
      fieldId: input.fieldId,
      category: input.category,
      title: input.title,
      notes: input.notes,
      coordinate: scan.coordinate,
      observedAt: scan.capturedAt,
      mediaIds: media.map((artifact) => artifact.id),
      syncState: 'queued',
    }

    await db.transaction(
      'rw',
      [db.observations, db.media, db.outbox, db.syncMetadata],
      async () => {
        await db.observations.add(observation)
        await db.media.bulkAdd(media)
        await queueMutation({
          entityType: 'observation',
          entityId: observation.id,
          operation: 'create',
          payload: observation,
        })
        for (const artifact of media) {
          await queueMutation({
            entityType: 'media',
            entityId: artifact.id,
            operation: 'create',
            payload: artifact,
          })
        }
      },
    )

    return { observation, media, scan }
  } catch (error) {
    try {
      await dependencies.cleanup(cleanupUris)
    } catch {
      // Preserve the capture/integrity error if best-effort cleanup also fails.
    }
    throw error
  }
}
