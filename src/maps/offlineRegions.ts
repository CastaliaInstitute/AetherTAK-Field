import {
  offlineMapRegionSchema,
  tileSourceIdPattern,
  type OfflineMapRegion,
} from '../domain/models'
import { db } from '../data/database'

export interface TileCoordinate {
  z: number
  x: number
  y: number
}

function validatedTileSourceId(tileSourceId: string) {
  if (!tileSourceIdPattern.test(tileSourceId)) {
    throw new Error('Map source ID must be an opaque identifier.')
  }
  return tileSourceId
}

// Preserve the historical cache-name mapping so an invalid legacy source can
// still be located and deleted. New manifests reject such identifiers.
export const mapCacheName = (tileSourceId: string) =>
  `aethertak-map-${tileSourceId}`

export const offlineTileCacheKey = (
  tileSourceId: string,
  coordinate: TileCoordinate,
) =>
  `https://offline-map.aethertak.invalid/${encodeURIComponent(validatedTileSourceId(tileSourceId))}/${coordinate.z}/${coordinate.x}/${coordinate.y}`

export const offlineMapStorageReserveBytes = 100 * 1024 * 1024

const maximumLatitude = 85.05112878
const clampLatitude = (latitude: number) =>
  Math.min(maximumLatitude, Math.max(-maximumLatitude, latitude))

interface StorageEstimateLike {
  usage?: number
  quota?: number
}

function defaultStorageEstimate(): Promise<StorageEstimateLike | null> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage?.estimate !== 'function'
  ) {
    return Promise.resolve(null)
  }
  return navigator.storage.estimate()
}

function availableStorageBytes(estimate: StorageEstimateLike | null) {
  if (
    !estimate ||
    !Number.isFinite(estimate.usage) ||
    !Number.isFinite(estimate.quota)
  ) {
    return null
  }
  return Math.max(0, (estimate.quota ?? 0) - (estimate.usage ?? 0))
}

function storageReserveError(reserveBytes: number) {
  const reserveMiB = Math.ceil(reserveBytes / (1024 * 1024))
  const error = new Error(
    `Offline map download paused to keep at least ${reserveMiB} MB of device storage free.`,
  )
  error.name = 'OfflineMapStorageError'
  return error
}

function isStorageQuotaError(error: unknown) {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'QuotaExceededError'
  ) {
    return true
  }
  if (!(error instanceof Error)) return false
  return (
    error.name === 'QuotaExceededError' ||
    /quota|storage (?:is )?full|no space left/i.test(error.message)
  )
}

function isStorageReserveError(error: unknown) {
  return error instanceof Error && error.name === 'OfflineMapStorageError'
}

function longitudeToTileX(longitude: number, zoom: number) {
  const count = 2 ** zoom
  return Math.min(
    count - 1,
    Math.max(0, Math.floor(((longitude + 180) / 360) * count)),
  )
}

function latitudeToTileY(latitude: number, zoom: number) {
  const radians = (clampLatitude(latitude) * Math.PI) / 180
  const count = 2 ** zoom
  return Math.min(
    count - 1,
    Math.max(
      0,
      Math.floor(
        ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * count,
      ),
    ),
  )
}

export function planRegionTiles(
  bounds: OfflineMapRegion['bounds'],
  minZoom: number,
  maxZoom: number,
): TileCoordinate[] {
  if (bounds.west > bounds.east) {
    throw new Error('Offline regions crossing the antimeridian are unsupported.')
  }
  if (bounds.south > bounds.north) {
    throw new Error('Offline region south must be below north.')
  }
  if (minZoom > maxZoom || minZoom < 0 || maxZoom > 22) {
    throw new Error('Invalid offline map zoom range.')
  }

  const tiles: TileCoordinate[] = []
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const minX = longitudeToTileX(bounds.west, z)
    const maxX = longitudeToTileX(bounds.east, z)
    const minY = latitudeToTileY(bounds.north, z)
    const maxY = latitudeToTileY(bounds.south, z)

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        tiles.push({ z, x, y })
      }
    }
  }
  return tiles
}

export function tileUrl(
  template: string,
  coordinate: TileCoordinate,
): string {
  return template
    .replaceAll('{z}', String(coordinate.z))
    .replaceAll('{x}', String(coordinate.x))
    .replaceAll('{y}', String(coordinate.y))
}

export function createOfflineMapRegion(
  input: Omit<
    OfflineMapRegion,
    'id' | 'tileCount' | 'downloadedTiles' | 'status' | 'updatedAt'
  >,
): OfflineMapRegion {
  const tileCount = planRegionTiles(
    input.bounds,
    input.minZoom,
    input.maxZoom,
  ).length
  return offlineMapRegionSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    tileCount,
    downloadedTiles: 0,
    status: 'planned',
    updatedAt: new Date().toISOString(),
  })
}

export interface RegionDownloadProgress {
  completed: number
  total: number
  failed: number
}

export interface OfflineMapReconciliation {
  regions: OfflineMapRegion[]
  changedRegions: number
  evictedTiles: number
}

interface LegacyOfflineMapRegion extends OfflineMapRegion {
  tileUrlTemplate?: string
}

interface TileSourceTemplate {
  id: string
  urlTemplate: string
}

function legacyTileUrlTemplate(region: OfflineMapRegion) {
  const value = (region as LegacyOfflineMapRegion).tileUrlTemplate
  return typeof value === 'string' && value.length > 0 ? value : null
}

function scrubLegacyTileUrlTemplate(region: OfflineMapRegion) {
  const {
    tileUrlTemplate: _legacyTileUrlTemplate,
    ...scrubbed
  } = region as LegacyOfflineMapRegion
  return offlineMapRegionSchema.parse(scrubbed)
}

async function migrateLegacyRegionCache(
  cache: Cache,
  region: OfflineMapRegion,
  source: TileSourceTemplate | null,
) {
  const template =
    legacyTileUrlTemplate(region) ??
    (source?.id === region.tileSourceId ? source.urlTemplate : null)
  if (!template) return 0

  let migrated = 0
  for (const coordinate of planRegionTiles(
    region.bounds,
    region.minZoom,
    region.maxZoom,
  )) {
    const cacheKey = offlineTileCacheKey(region.tileSourceId, coordinate)
    if (await cache.match(cacheKey)) continue
    const legacyKey = tileUrl(template, coordinate)
    const response = await cache.match(legacyKey)
    if (!response) continue
    await cache.put(cacheKey, response)
    if (!(await cache.delete(legacyKey))) {
      await cache.delete(cacheKey)
      throw new Error('Legacy offline map cache key could not be removed.')
    }
    migrated += 1
  }
  return migrated
}

export async function reconcileOfflineMapRegions(
  regions: OfflineMapRegion[],
  source: TileSourceTemplate | null = null,
): Promise<OfflineMapReconciliation> {
  if (regions.length === 0) {
    return { regions: [], changedRegions: 0, evictedTiles: 0 }
  }
  if (!('caches' in globalThis)) {
    throw new Error(
      'Offline map inventory cannot be verified because Cache Storage is unavailable.',
    )
  }

  const cachedUrlsBySource = new Map<string, Set<string>>()
  for (const sourceId of new Set(
    regions.map((region) => region.tileSourceId),
  )) {
    const cache = await caches.open(mapCacheName(sourceId))
    for (const region of regions.filter(
      (candidate) => candidate.tileSourceId === sourceId,
    )) {
      await migrateLegacyRegionCache(cache, region, source)
    }
    const keys = await cache.keys()
    cachedUrlsBySource.set(
      sourceId,
      new Set(keys.map((request) => request.url)),
    )
  }

  let changedRegions = 0
  let evictedTiles = 0
  const updates: OfflineMapRegion[] = []
  const reconciled = regions.map((region) => {
    const cachedUrls = cachedUrlsBySource.get(region.tileSourceId)
    const expectedUrls = planRegionTiles(
      region.bounds,
      region.minZoom,
      region.maxZoom,
    ).map((coordinate) =>
      offlineTileCacheKey(region.tileSourceId, coordinate))
    const downloadedTiles = expectedUrls.reduce(
      (count, url) => count + (cachedUrls?.has(url) ? 1 : 0),
      0,
    )
    const tileCount = expectedUrls.length
    evictedTiles += Math.max(0, region.downloadedTiles - downloadedTiles)
    const status: OfflineMapRegion['status'] =
      downloadedTiles === tileCount
        ? 'ready'
        : downloadedTiles > 0
          ? 'partial'
          : region.status === 'planned'
            ? 'planned'
            : 'failed'
    const hasLegacyTemplate = legacyTileUrlTemplate(region) !== null
    if (
      region.downloadedTiles === downloadedTiles &&
      region.tileCount === tileCount &&
      region.status === status &&
      !hasLegacyTemplate
    ) {
      return region
    }
    changedRegions += 1
    const updated = offlineMapRegionSchema.parse({
      ...scrubLegacyTileUrlTemplate(region),
      tileCount,
      downloadedTiles,
      status,
      updatedAt: new Date().toISOString(),
    })
    updates.push(updated)
    return updated
  })

  if (updates.length > 0) {
    await db.offlineMapRegions.bulkPut(updates)
  }
  return { regions: reconciled, changedRegions, evictedTiles }
}

export async function downloadOfflineMapRegion(
  region: OfflineMapRegion,
  options: {
    tileUrlTemplate: string
    signal?: AbortSignal
    maxTiles?: number
    onProgress?: (progress: RegionDownloadProgress) => void
    minimumFreeBytes?: number
    storageCheckInterval?: number
    storageEstimate?: () => Promise<StorageEstimateLike | null>
  },
) {
  if (!('caches' in globalThis)) {
    throw new Error('Cache Storage is unavailable on this platform.')
  }
  const tiles = planRegionTiles(region.bounds, region.minZoom, region.maxZoom)
  const maxTiles = options.maxTiles ?? 20_000
  if (tiles.length > maxTiles) {
    throw new Error(
      `Offline region contains ${tiles.length} tiles; limit is ${maxTiles}.`,
    )
  }
  const minimumFreeBytes =
    options.minimumFreeBytes ?? offlineMapStorageReserveBytes
  const storageCheckInterval = options.storageCheckInterval ?? 25
  if (!Number.isFinite(minimumFreeBytes) || minimumFreeBytes < 0) {
    throw new Error('Offline map storage reserve must be non-negative.')
  }
  if (
    !Number.isInteger(storageCheckInterval) ||
    storageCheckInterval < 1
  ) {
    throw new Error('Offline map storage check interval must be positive.')
  }
  const estimateStorage = options.storageEstimate ?? defaultStorageEstimate

  const cache = await caches.open(mapCacheName(region.tileSourceId))
  let completed = 0
  let failed = 0
  let terminalError: unknown
  let uncachedSinceStorageCheck = storageCheckInterval
  await db.offlineMapRegions.put({
    ...region,
    status: 'downloading',
    updatedAt: new Date().toISOString(),
  })

  for (const coordinate of tiles) {
    if (options.signal?.aborted) break
    const url = tileUrl(options.tileUrlTemplate, coordinate)
    const cacheKey = offlineTileCacheKey(region.tileSourceId, coordinate)
    try {
      const existing = await cache.match(cacheKey)
      if (!existing) {
        if (uncachedSinceStorageCheck >= storageCheckInterval) {
          const available = availableStorageBytes(await estimateStorage())
          if (available !== null && available < minimumFreeBytes) {
            throw storageReserveError(minimumFreeBytes)
          }
          uncachedSinceStorageCheck = 0
        }
        const response = await fetch(url, {
          signal: options.signal,
          cache: 'no-store',
        })
        if (!response.ok) {
          throw new Error(`Tile request returned HTTP ${response.status}.`)
        }
        await cache.put(cacheKey, response)
        uncachedSinceStorageCheck += 1
      }
      completed += 1
    } catch (error) {
      if (options.signal?.aborted) break
      failed += 1
      const quotaExceeded = isStorageQuotaError(error)
      if (quotaExceeded || isStorageReserveError(error)) {
        if (quotaExceeded) {
          terminalError = new Error(
            'Offline map download paused because device storage is full.',
          )
        } else {
          terminalError = error
        }
      } else if (failed >= 10) {
        terminalError = error
      }
    }
    options.onProgress?.({ completed, total: tiles.length, failed })
    if ((completed + failed) % 25 === 0) {
      await db.offlineMapRegions.put({
        ...region,
        downloadedTiles: completed,
        status: 'downloading',
        updatedAt: new Date().toISOString(),
      })
    }
    if (terminalError) break
  }

  const status: OfflineMapRegion['status'] =
    completed === tiles.length
      ? 'ready'
      : completed > 0
        ? 'partial'
        : 'failed'
  const updated = {
    ...region,
    downloadedTiles: completed,
    status,
    updatedAt: new Date().toISOString(),
  }
  await db.offlineMapRegions.put(updated)
  if (terminalError) throw terminalError
  return updated
}

export async function deleteOfflineMapRegion(region: OfflineMapRegion) {
  if ('caches' in globalThis) {
    if (!tileSourceIdPattern.test(region.tileSourceId)) {
      await caches.delete(mapCacheName(region.tileSourceId))
      await db.offlineMapRegions.delete(region.id)
      return
    }
    const cache = await caches.open(mapCacheName(region.tileSourceId))
    const otherRegions = await db.offlineMapRegions
      .where('tileSourceId')
      .equals(region.tileSourceId)
      .filter((item) => item.id !== region.id)
      .toArray()
    const retainedUrls = new Set(
      otherRegions.flatMap((item) =>
        planRegionTiles(item.bounds, item.minZoom, item.maxZoom).map(
          (coordinate) => offlineTileCacheKey(item.tileSourceId, coordinate),
        ),
      ),
    )
    for (const coordinate of planRegionTiles(
      region.bounds,
      region.minZoom,
      region.maxZoom,
    )) {
      const cacheKey = offlineTileCacheKey(region.tileSourceId, coordinate)
      if (!retainedUrls.has(cacheKey)) await cache.delete(cacheKey)
    }
  }
  await db.offlineMapRegions.delete(region.id)
}
