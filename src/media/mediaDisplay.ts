import { Capacitor } from '@capacitor/core'
import type { MediaCapture, Observation } from '../domain/models'

export interface ObservationArtifact {
  id: string
  media: MediaCapture | null
}

const nativeFileSchemes = ['file:', 'content:', 'capacitor:']
const localMediaHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

function isDirectlyRenderable(uri: string) {
  if (uri.startsWith('blob:')) return true
  if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(uri)) return true
  try {
    const parsed = new URL(uri)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      localMediaHosts.has(parsed.hostname)
    )
  } catch {
    return false
  }
}

export function mediaDisplayUri(
  uri: string | null,
  convertFileSrc = Capacitor.convertFileSrc,
) {
  if (!uri) return null
  if (isDirectlyRenderable(uri)) return uri
  if (nativeFileSchemes.some((scheme) => uri.startsWith(scheme))) {
    return convertFileSrc(uri)
  }
  return null
}

export function observationArtifacts(
  observation: Observation,
  media: MediaCapture[],
): ObservationArtifact[] {
  const byId = new Map(media.map((artifact) => [artifact.id, artifact]))
  return observation.mediaIds.map((id) => ({
    id,
    media: byId.get(id) ?? null,
  }))
}

export function artifactLabel(kind: MediaCapture['kind']) {
  const labels: Record<MediaCapture['kind'], string> = {
    photo: 'Photo',
    video: 'Video',
    depth: 'Metric depth',
    depth_confidence: 'Depth confidence',
    point_cloud: 'Point cloud',
    model: '3D model',
  }
  return labels[kind]
}
