import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildPwaAssets,
  createPngIcon,
} from './pwa-build.mjs'

function pngDimensions(bytes) {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  )
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

test('generates deterministic install icons', () => {
  const first = createPngIcon(192)
  const second = createPngIcon(192)

  assert.deepEqual(first, second)
  assert.deepEqual(pngDimensions(first), { width: 192, height: 192 })
  assert.deepEqual(
    pngDimensions(createPngIcon(512, true)),
    { width: 512, height: 512 },
  )
})

test('builds a content-versioned offline shell without touching map caches', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aethertak-pwa-'))
  try {
    await mkdir(path.join(directory, 'assets'))
    await writeFile(path.join(directory, 'index.html'), '<main>Field</main>')
    await writeFile(path.join(directory, 'manifest.webmanifest'), '{}')
    await writeFile(path.join(directory, 'assets', 'app.js'), 'app()')

    const first = await buildPwaAssets(directory)
    const worker = await readFile(path.join(directory, 'sw.js'), 'utf8')
    assert.match(first.cacheName, /^aethertak-field-shell-[a-f0-9]{20}$/)
    assert.deepEqual(first.shellUrls, [
      '/assets/app.js',
      '/icons/aethertak-field-192.png',
      '/icons/aethertak-field-512.png',
      '/icons/aethertak-field-maskable-512.png',
      '/index.html',
      '/manifest.webmanifest',
    ])
    assert.match(worker, /request\.mode === 'navigate'/)
    assert.ok(worker.includes("cache.match('/index.html')"))
    assert.doesNotMatch(worker, /aethertak-map-/)

    const repeated = await buildPwaAssets(directory)
    assert.equal(repeated.cacheName, first.cacheName)
    await writeFile(path.join(directory, 'assets', 'app.js'), 'changed()')
    const changed = await buildPwaAssets(directory)
    assert.notEqual(changed.cacheName, first.cacheName)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
