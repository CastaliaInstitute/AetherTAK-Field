import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const shellCachePrefix = 'aethertak-field-shell-'
const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

async function filesBelow(directory, prefix = '') {
  const entries = await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })
  const files = []
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...await filesBelow(directory, relative))
    } else {
      files.push(relative)
    }
  }
  return files
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function colorAt(size, x, y, maskable) {
  const scale = size / 512
  const distanceToSegment = (ax, ay, bx, by) => {
    const dx = bx - ax
    const dy = by - ay
    const lengthSquared = dx * dx + dy * dy
    const projection = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared),
    )
    return Math.hypot(x - (ax + projection * dx), y - (ay + projection * dy))
  }
  const lineWidth = (maskable ? 54 : 62) * scale
  const left = distanceToSegment(
    150 * scale,
    365 * scale,
    256 * scale,
    130 * scale,
  )
  const right = distanceToSegment(
    256 * scale,
    130 * scale,
    362 * scale,
    365 * scale,
  )
  const cross = distanceToSegment(
    195 * scale,
    275 * scale,
    317 * scale,
    275 * scale,
  )
  const leafX = x - 346 * scale
  const leafY = y - 146 * scale
  const leaf =
    ((leafX + leafY * 0.45) / (51 * scale)) ** 2 +
      ((leafY - leafX * 0.45) / (30 * scale)) ** 2 <=
    1

  if (left <= lineWidth / 2 || right <= lineWidth / 2 || cross <= lineWidth / 2) {
    return [155, 225, 136, 255]
  }
  if (leaf) return [113, 212, 209, 255]
  return [23, 34, 28, 255]
}

export function createPngIcon(size, maskable = false) {
  const scanlines = Buffer.alloc((size * 4 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    scanlines[offset] = 0
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const color = colorAt(size, x, y, maskable)
      for (const channel of color) {
        scanlines[offset] = channel
        offset += 1
      }
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function workerSource(cacheName, shellUrls) {
  return `const CACHE_NAME = ${JSON.stringify(cacheName)}
const SHELL_URLS = ${JSON.stringify(shellUrls, null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith(${JSON.stringify(shellCachePrefix)}) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.open(CACHE_NAME).then((cache) => cache.match('/index.html')),
      ),
    )
    return
  }

  if (!SHELL_URLS.includes(url.pathname)) return
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => cached || fetch(request)),
    ),
  )
})
`
}

export async function buildPwaAssets(directory) {
  const icons = path.join(directory, 'icons')
  await mkdir(icons, { recursive: true })
  await Promise.all([
    writeFile(
      path.join(icons, 'aethertak-field-192.png'),
      createPngIcon(192),
    ),
    writeFile(
      path.join(icons, 'aethertak-field-512.png'),
      createPngIcon(512),
    ),
    writeFile(
      path.join(icons, 'aethertak-field-maskable-512.png'),
      createPngIcon(512, true),
    ),
  ])

  const files = (await filesBelow(directory))
    .filter((file) => file !== 'sw.js')
    .sort()
  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(file)
    digest.update(await readFile(path.join(directory, file)))
  }
  const revision = digest.digest('hex').slice(0, 20)
  const shellUrls = files.map((file) => `/${file}`)
  const cacheName = `${shellCachePrefix}${revision}`
  await writeFile(
    path.join(directory, 'sw.js'),
    workerSource(cacheName, shellUrls),
  )
  return { cacheName, shellUrls }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await buildPwaAssets(path.resolve(process.argv[2] ?? 'dist'))
}
