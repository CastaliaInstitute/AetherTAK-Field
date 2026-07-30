import {
  offlineMapRegionSchema,
  type OfflineMapRegion,
} from '../domain/models'
import { db } from '../data/database'

export interface TileCoordinate {
  z: number
  x: number
  y: number
}

export const mapCacheName = (tileSourceId: string) =>
  `aethertak-map-${tileSourceId}`

const maximumLatitude = 85.05112878
const clampLatitude = (latitude: number) =>
  Math.min(maximumLatitude, Math.max(-maximumLatitude, latitude))

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

export async function downloadOfflineMapRegion(
  region: OfflineMapRegion,
  options: {
    signal?: AbortSignal
    maxTiles?: number
    onProgress?: (progress: RegionDownloadProgress) => void
  } = {},
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

  const cache = await caches.open(mapCacheName(region.tileSourceId))
  let completed = 0
  let failed = 0
  await db.offlineMapRegions.put({
    ...region,
    status: 'downloading',
    updatedAt: new Date().toISOString(),
  })

  for (const coordinate of tiles) {
    if (options.signal?.aborted) break
    const url = tileUrl(region.tileUrlTemplate, coordinate)
    try {
      const existing = await cache.match(url)
      if (!existing) {
        const response = await fetch(url, {
          signal: options.signal,
          cache: 'no-store',
        })
        if (!response.ok) {
          throw new Error(`Tile request returned HTTP ${response.status}.`)
        }
        await cache.put(url, response)
      }
      completed += 1
    } catch (error) {
      if (options.signal?.aborted) break
      failed += 1
      if (failed >= 10) {
        throw error
      }
    }
    options.onProgress?.({ completed, total: tiles.length, failed })
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
  return updated
}

export async function deleteOfflineMapRegion(region: OfflineMapRegion) {
  if ('caches' in globalThis) {
    const cache = await caches.open(mapCacheName(region.tileSourceId))
    for (const coordinate of planRegionTiles(
      region.bounds,
      region.minZoom,
      region.maxZoom,
    )) {
      await cache.delete(tileUrl(region.tileUrlTemplate, coordinate))
    }
  }
  await db.offlineMapRegions.delete(region.id)
}
