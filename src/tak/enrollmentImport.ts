import { Directory, Filesystem } from '@capacitor/filesystem'
import { takTransport } from '../platform/tak'

const maximumPackageBytes = 25 * 1024 * 1024

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 32 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    )
  }
  return btoa(binary)
}

export async function importTakDataPackage(file: File) {
  if (
    file.size <= 0 ||
    file.size > maximumPackageBytes ||
    !file.name.toLowerCase().endsWith('.zip')
  ) {
    throw new Error('Choose a TAK data-package ZIP smaller than 25 MB.')
  }
  const path = `enrollment/${crypto.randomUUID()}.zip`
  const written = await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: base64(await file.arrayBuffer()),
    recursive: true,
  })
  try {
    return await takTransport.importEnrollmentPackage(written.uri)
  } finally {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Cache,
    }).catch(() => undefined)
  }
}
