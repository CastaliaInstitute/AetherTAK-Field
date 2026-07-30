import * as maplibregl from 'maplibre-gl'
import { mapCacheName, tileUrl, type TileCoordinate } from './offlineRegions'

export interface RasterTileSource {
  id: string
  urlTemplate: string
  attribution: string
  allowOfflineDownload: boolean
}

export const activeRasterSource: RasterTileSource = {
  id: import.meta.env.VITE_MAP_TILE_SOURCE_ID ?? 'osm-preview',
  urlTemplate:
    import.meta.env.VITE_MAP_TILE_URL ??
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    import.meta.env.VITE_MAP_ATTRIBUTION ??
    '© OpenStreetMap contributors',
  allowOfflineDownload:
    import.meta.env.VITE_MAP_TILE_ALLOW_OFFLINE === 'true',
}

const protocol = 'aether-raster'
let protocolRegistered = false

export function protocolTileUrl(
  sourceId: string,
  coordinate: TileCoordinate,
) {
  return `${protocol}://${encodeURIComponent(sourceId)}/${coordinate.z}/${coordinate.x}/${coordinate.y}`
}

export function parseProtocolTileUrl(url: string): {
  sourceId: string
  coordinate: TileCoordinate
} {
  const parsed = new URL(url)
  if (parsed.protocol !== `${protocol}:`) {
    throw new Error('Unsupported AetherTAK map protocol.')
  }
  const values = parsed.pathname.split('/').filter(Boolean).map(Number)
  if (
    values.length !== 3 ||
    values.some((value) => !Number.isInteger(value) || value < 0)
  ) {
    throw new Error('Invalid AetherTAK map tile coordinate.')
  }
  return {
    sourceId: decodeURIComponent(parsed.hostname),
    coordinate: { z: values[0], x: values[1], y: values[2] },
  }
}

export function registerRasterTileProtocol(source: RasterTileSource) {
  if (protocolRegistered) return

  maplibregl.addProtocol(protocol, async (request, controller) => {
    const parsed = parseProtocolTileUrl(request.url)
    if (parsed.sourceId !== source.id) {
      throw new Error(`Unknown raster source ${parsed.sourceId}.`)
    }
    const networkUrl = tileUrl(source.urlTemplate, parsed.coordinate)
    let response: Response | undefined

    if ('caches' in globalThis) {
      const cache = await caches.open(mapCacheName(source.id))
      response = (await cache.match(networkUrl)) ?? undefined
    }

    if (!response) {
      response = await fetch(networkUrl, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Map tile returned HTTP ${response.status}.`)
      }
      if (source.allowOfflineDownload && 'caches' in globalThis) {
        const cache = await caches.open(mapCacheName(source.id))
        await cache.put(networkUrl, response.clone())
      }
    }

    return {
      data: await response.arrayBuffer(),
      cacheControl: response.headers.get('cache-control') ?? undefined,
      expires: response.headers.get('expires') ?? undefined,
    }
  })
  protocolRegistered = true
}

export function rasterStyleUrl(source: RasterTileSource) {
  return `${protocol}://${encodeURIComponent(source.id)}/{z}/{x}/{y}`
}
