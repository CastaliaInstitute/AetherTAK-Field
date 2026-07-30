import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { takTransport } from '../platform/tak'
import type { TakActivity } from './activity'

const maximumPackageBytes = 25 * 1024 * 1024

function bytesToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 32 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function safeFileName(value: string) {
  const normalized = value
    .normalize('NFKC')
    .replaceAll(/[^A-Za-z0-9._-]/g, '_')
    .replaceAll(/_+/g, '_')
    .slice(0, 120)
  return normalized.toLowerCase().endsWith('.zip')
    ? normalized
    : `${normalized || 'mission-package'}.zip`
}

function hasZipSignature(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    )
  )
}

function hasMissionManifest(bytes: Uint8Array) {
  const marker = new TextEncoder().encode('MANIFEST/manifest.xml')
  outer: for (let offset = 0; offset <= bytes.length - marker.length; offset += 1) {
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[offset + index] !== marker[index]) continue outer
    }
    return true
  }
  return false
}

export interface PersistedMissionPackage {
  fileName: string
  storagePath: string
  localUri: string
  sizeBytes: number
}

export async function persistMissionPackage(
  file: File,
): Promise<PersistedMissionPackage> {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    throw new Error('Choose a TAK mission-package ZIP.')
  }
  if (file.size <= 0 || file.size > maximumPackageBytes) {
    throw new Error('Mission packages must be between 1 byte and 25 MiB.')
  }
  const buffer = await file.arrayBuffer()
  if (!hasZipSignature(new Uint8Array(buffer))) {
    throw new Error('The selected file is not a valid ZIP container.')
  }
  if (!hasMissionManifest(new Uint8Array(buffer))) {
    throw new Error(
      'The ZIP has no MANIFEST/manifest.xml and is not a TAK mission package.',
    )
  }
  const fileName = safeFileName(file.name)
  const storagePath = `mission-packages/outbound/${crypto.randomUUID()}-${fileName}`
  const result = await Filesystem.writeFile({
    path: storagePath,
    directory: Directory.LibraryNoCloud,
    data: bytesToBase64(buffer),
    recursive: true,
  })
  return {
    fileName,
    storagePath,
    localUri: result.uri,
    sizeBytes: file.size,
  }
}

export async function removePersistedMissionPackage(storagePath: string) {
  try {
    await Filesystem.deleteFile({
      path: storagePath,
      directory: Directory.LibraryNoCloud,
    })
  } catch {
    await Filesystem.deleteFile({
      path: storagePath,
      directory: Directory.Data,
    })
  }
}

export async function downloadMissionPackage(
  activity: TakActivity,
) {
  const transfer = activity.fileTransfer
  if (
    !transfer ||
    transfer.mode !== 'request' ||
    !transfer.senderUrl ||
    !/^[0-9a-f]{64}$/.test(transfer.sha256 ?? '')
  ) {
    throw new Error('This TAK event has no valid downloadable mission package.')
  }
  return takTransport.downloadMissionPackage({
    senderUrl: transfer.senderUrl,
    fileName: transfer.fileName,
    expectedSha256: transfer.sha256!,
    expectedSizeBytes: transfer.sizeBytes,
  })
}

export async function shareDownloadedMissionPackage(activity: TakActivity) {
  const transfer = activity.fileTransfer
  if (!transfer?.localUri || transfer.status !== 'downloaded') {
    throw new Error('Download and verify this mission package first.')
  }
  await Share.share({
    title: transfer.transferName,
    text: `${transfer.transferName} from ${transfer.senderCallsign}`,
    files: [transfer.localUri],
    dialogTitle: 'Open or share verified TAK package',
  })
}
