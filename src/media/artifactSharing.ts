import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import type { MediaCapture, Observation } from '../domain/models'
import { artifactLabel } from './mediaDisplay'

interface ArtifactShareDependencies {
  isNative: () => boolean
  canShare: () => Promise<{ value: boolean }>
  share: (options: {
    title: string
    text: string
    files: string[]
    dialogTitle: string
  }) => Promise<unknown>
}

const shareableSchemes = new Set(['file:', 'content:', 'capacitor:'])
const verifiedDigest = /^[0-9a-f]{64}$/

function isLocalFileUri(uri: string) {
  if (uri.length > 4_096) return false
  try {
    return shareableSchemes.has(new URL(uri).protocol)
  } catch {
    return false
  }
}

export function createArtifactSharingClient(
  dependencies: ArtifactShareDependencies,
) {
  return {
    canShare(artifact: MediaCapture) {
      return (
        dependencies.isNative() &&
        verifiedDigest.test(artifact.sha256 ?? '') &&
        isLocalFileUri(artifact.localUri)
      )
    },

    async share(artifact: MediaCapture, observation: Observation) {
      if (!this.canShare(artifact)) {
        throw new Error(
          'Only checksum-verified files stored on this device can be opened or shared.',
        )
      }
      if (!(await dependencies.canShare()).value) {
        throw new Error('The system share sheet is unavailable on this device.')
      }
      const label = artifactLabel(artifact.kind)
      const provenance = artifact.deviceModel
        ? `Captured with ${artifact.deviceModel}.`
        : 'Capture hardware was not reported.'
      await dependencies.share({
        title: `${label} · ${observation.title}`,
        text: [
          `${label} captured ${new Date(artifact.capturedAt).toISOString()}.`,
          provenance,
          `SHA-256 ${artifact.sha256}.`,
        ].join(' '),
        files: [artifact.localUri],
        dialogTitle: `Open or share verified ${label.toLowerCase()}`,
      })
    },
  }
}

export const artifactSharing = createArtifactSharingClient({
  isNative: () => Capacitor.isNativePlatform(),
  canShare: () => Share.canShare(),
  share: (options) => Share.share(options),
})
