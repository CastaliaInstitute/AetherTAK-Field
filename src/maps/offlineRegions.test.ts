import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../data/database'
import {
  createOfflineMapRegion,
  deleteOfflineMapRegion,
  downloadOfflineMapRegion as downloadRegion,
  mapCacheName,
  offlineTileCacheKey,
  offlineMapStorageReserveBytes,
  planRegionTiles,
  reconcileOfflineMapRegions,
  tileUrl,
} from './offlineRegions'

const bounds = {
  west: -104.9973,
  south: 39.7383,
  east: -104.9882,
  north: 39.743,
}

const tileUrlTemplate =
  'https://maps.example.test/{z}/{x}/{y}.png?token=do-not-persist'

function downloadOfflineMapRegion(
  region: Parameters<typeof downloadRegion>[0],
  options: Omit<Parameters<typeof downloadRegion>[1], 'tileUrlTemplate'> = {},
) {
  return downloadRegion(region, { tileUrlTemplate, ...options })
}

class MemoryCache {
  readonly entries = new Map<string, Response>()

  async match(request: RequestInfo | URL) {
    return this.entries.get(String(request))?.clone()
  }

  async put(request: RequestInfo | URL, response: Response) {
    this.entries.set(String(request), response.clone())
  }

  async delete(request: RequestInfo | URL) {
    return this.entries.delete(String(request))
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
}

const memoryCaches = new Map<string, MemoryCache>()
const cacheStorage = {
  async open(name: string) {
    let cache = memoryCaches.get(name)
    if (!cache) {
      cache = new MemoryCache()
      memoryCaches.set(name, cache)
    }
    return cache
  },
}

describe('offline map regions', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    memoryCaches.clear()
    vi.unstubAllGlobals()
    vi.stubGlobal('caches', cacheStorage)
  })

  afterAll(async () => {
    await db.delete()
    vi.unstubAllGlobals()
  })

  it('plans deterministic slippy-map tile coordinates', () => {
    const first = planRegionTiles(bounds, 12, 15)
    const second = planRegionTiles(bounds, 12, 15)

    expect(first.length).toBeGreaterThan(0)
    expect(first).toEqual(second)
    expect(new Set(first.map((tile) => `${tile.z}/${tile.x}/${tile.y}`)).size).toBe(
      first.length,
    )
  })

  it('creates a validated region manifest with an exact tile count', () => {
    const region = createOfflineMapRegion({
      name: 'Aether Urban Farm',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 15,
    })

    expect(region.tileCount).toBe(planRegionTiles(bounds, 12, 15).length)
    expect(region.status).toBe('planned')
    expect(region).not.toHaveProperty('tileUrlTemplate')
  })

  it('expands templates and rejects unsafe geometry ranges', () => {
    expect(
      tileUrl('https://maps.test/{z}/{x}/{y}.png', {
        z: 4,
        x: 2,
        y: 6,
      }),
    ).toBe('https://maps.test/4/2/6.png')
    expect(() =>
      planRegionTiles({ ...bounds, west: 170, east: -170 }, 1, 2),
    ).toThrow('antimeridian')
    expect(() => planRegionTiles(bounds, 18, 17)).toThrow('zoom range')
    expect(() =>
      createOfflineMapRegion({
        name: 'Credential-shaped source',
        tileSourceId: 'https://maps.test/?token=secret',
        bounds,
        minZoom: 12,
        maxZoom: 13,
      }),
    ).toThrow()
    expect(() =>
      offlineTileCacheKey('token=secret', { z: 1, x: 1, y: 1 }),
    ).toThrow('opaque identifier')
  })

  it('persists a partial region and resumes without refetching cached tiles', async () => {
    const region = createOfflineMapRegion({
      name: 'Interrupted field',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 17,
    })
    const controller = new AbortController()
    let requests = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        requests += 1
        if (requests === 3) controller.abort()
        return new Response('tile', { status: 200 })
      }),
    )

    const partial = await downloadOfflineMapRegion(region, {
      signal: controller.signal,
    })

    expect(partial.status).toBe('partial')
    expect(partial.downloadedTiles).toBe(3)
    expect(await db.offlineMapRegions.get(region.id)).toMatchObject({
      status: 'partial',
      downloadedTiles: 3,
    })
    const cache = await cacheStorage.open(mapCacheName(region.tileSourceId))
    const cachedRequests = await cache.keys()
    expect(cachedRequests).toHaveLength(3)
    for (const request of cachedRequests) {
      expect(request.url).toMatch(
        /^https:\/\/offline-map\.aethertak\.invalid\//,
      )
      expect(request.url).not.toContain('do-not-persist')
      expect(request.url).not.toContain('maps.example.test')
    }

    const fetchAfterInterruption = requests
    const resumed = await downloadOfflineMapRegion(partial)

    expect(resumed.status).toBe('ready')
    expect(resumed.downloadedTiles).toBe(region.tileCount)
    expect(requests - fetchAfterInterruption).toBe(region.tileCount - 3)
  })

  it('persists a failed manifest before surfacing repeated tile errors', async () => {
    const region = createOfflineMapRegion({
      name: 'Unavailable source',
      tileSourceId: 'unavailable-source',
      bounds,
      minZoom: 12,
      maxZoom: 17,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    )

    await expect(downloadOfflineMapRegion(region)).rejects.toThrow(
      'HTTP 503',
    )
    expect(await db.offlineMapRegions.get(region.id)).toMatchObject({
      status: 'failed',
      downloadedTiles: 0,
    })
    expect(fetch).toHaveBeenCalledTimes(10)
  })

  it('refuses a new download when the device storage reserve is unavailable', async () => {
    const region = createOfflineMapRegion({
      name: 'Storage constrained field',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 13,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('tile', { status: 200 })),
    )

    await expect(
      downloadOfflineMapRegion(region, {
        storageEstimate: async () => ({
          usage: 950 * 1024 * 1024,
          quota: 1024 * 1024 * 1024,
        }),
      }),
    ).rejects.toThrow('keep at least 100 MB')

    expect(fetch).not.toHaveBeenCalled()
    expect(await db.offlineMapRegions.get(region.id)).toMatchObject({
      status: 'failed',
      downloadedTiles: 0,
    })
  })

  it('keeps downloaded tiles and a resumable manifest when storage falls below reserve', async () => {
    const region = createOfflineMapRegion({
      name: 'Growing cache',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 14,
    })
    const estimate = vi
      .fn<() => Promise<{ usage: number; quota: number }>>()
      .mockResolvedValueOnce({
        usage: 0,
        quota: 1024 * 1024 * 1024,
      })
      .mockResolvedValue({
        usage: 950 * 1024 * 1024,
        quota: 1024 * 1024 * 1024,
      })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('tile', { status: 200 })),
    )

    await expect(
      downloadOfflineMapRegion(region, {
        minimumFreeBytes: offlineMapStorageReserveBytes,
        storageCheckInterval: 1,
        storageEstimate: estimate,
      }),
    ).rejects.toThrow('download paused')

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await db.offlineMapRegions.get(region.id)).toMatchObject({
      status: 'partial',
      downloadedTiles: 1,
    })
  })

  it('stops after the first cache quota error instead of retrying every tile', async () => {
    const region = createOfflineMapRegion({
      name: 'Full cache',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 14,
    })
    const fullCache = new MemoryCache()
    fullCache.put = async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    vi.stubGlobal('caches', {
      open: async () => fullCache,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('tile', { status: 200 })),
    )

    await expect(
      downloadOfflineMapRegion(region, {
        minimumFreeBytes: 0,
        storageEstimate: async () => null,
      }),
    ).rejects.toThrow('device storage is full')

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await db.offlineMapRegions.get(region.id)).toMatchObject({
      status: 'failed',
      downloadedTiles: 0,
    })
  })

  it('downgrades a ready manifest after the device evicts cached tiles', async () => {
    const region = createOfflineMapRegion({
      name: 'Evicted field',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 14,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('tile', { status: 200 })),
    )
    const ready = await downloadOfflineMapRegion(region, {
      minimumFreeBytes: 0,
      storageEstimate: async () => null,
    })
    const cache = await cacheStorage.open(mapCacheName(region.tileSourceId))
    const urls = planRegionTiles(
      region.bounds,
      region.minZoom,
      region.maxZoom,
    ).map((coordinate) => offlineTileCacheKey(region.tileSourceId, coordinate))

    await cache.delete(urls[0])
    const partial = await reconcileOfflineMapRegions([ready])

    expect(partial.changedRegions).toBe(1)
    expect(partial.evictedTiles).toBe(1)
    expect(partial.regions[0]).toMatchObject({
      status: 'partial',
      downloadedTiles: ready.tileCount - 1,
    })
    expect(await db.offlineMapRegions.get(region.id)).toMatchObject({
      status: 'partial',
      downloadedTiles: ready.tileCount - 1,
    })

    for (const url of urls.slice(1)) await cache.delete(url)
    const failed = await reconcileOfflineMapRegions(partial.regions)
    expect(failed).toMatchObject({
      changedRegions: 1,
      evictedTiles: ready.tileCount - 1,
    })
    expect(failed.regions[0]).toMatchObject({
      status: 'failed',
      downloadedTiles: 0,
    })
  })

  it('recovers cached progress written after the last manifest checkpoint', async () => {
    const region = {
      ...createOfflineMapRegion({
        name: 'Recovered field',
        tileSourceId: 'authorized-field-basemap',
        bounds,
        minZoom: 12,
        maxZoom: 14,
      }),
      status: 'partial' as const,
      downloadedTiles: 1,
    }
    await db.offlineMapRegions.put(region)
    const cache = await cacheStorage.open(mapCacheName(region.tileSourceId))
    const urls = planRegionTiles(
      region.bounds,
      region.minZoom,
      region.maxZoom,
    ).map((coordinate) => offlineTileCacheKey(region.tileSourceId, coordinate))
    for (const url of urls.slice(0, 3)) {
      await cache.put(url, new Response('tile', { status: 200 }))
    }

    const result = await reconcileOfflineMapRegions([region])

    expect(result).toMatchObject({
      changedRegions: 1,
      evictedTiles: 0,
    })
    expect(result.regions[0]).toMatchObject({
      status: 'partial',
      downloadedTiles: 3,
    })
  })

  it('rekeys legacy tiles and scrubs credential-bearing manifests', async () => {
    const region = createOfflineMapRegion({
      name: 'Legacy credential cache',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 13,
    })
    const legacyRegion = {
      ...region,
      tileUrlTemplate,
      status: 'partial' as const,
      downloadedTiles: 1,
    }
    await db.offlineMapRegions.put(legacyRegion)
    const coordinate = planRegionTiles(
      region.bounds,
      region.minZoom,
      region.maxZoom,
    )[0]
    const legacyKey = tileUrl(tileUrlTemplate, coordinate)
    const safeKey = offlineTileCacheKey(region.tileSourceId, coordinate)
    const cache = await cacheStorage.open(mapCacheName(region.tileSourceId))
    await cache.put(legacyKey, new Response('legacy tile', { status: 200 }))

    const result = await reconcileOfflineMapRegions(
      [legacyRegion],
      { id: region.tileSourceId, urlTemplate: tileUrlTemplate },
    )

    expect(result.changedRegions).toBe(1)
    expect(result.regions[0]).toMatchObject({
      downloadedTiles: 1,
      status: 'partial',
    })
    expect(result.regions[0]).not.toHaveProperty('tileUrlTemplate')
    expect(await cache.match(safeKey)).toBeDefined()
    expect(await cache.match(legacyKey)).toBeUndefined()
    const persisted = await db.offlineMapRegions.get(region.id)
    expect(persisted).not.toHaveProperty('tileUrlTemplate')
    expect(JSON.stringify(persisted)).not.toContain('do-not-persist')
  })

  it('leaves an untouched planned region planned when its cache is empty', async () => {
    const region = createOfflineMapRegion({
      name: 'Planned field',
      tileSourceId: 'authorized-field-basemap',
      bounds,
      minZoom: 12,
      maxZoom: 13,
    })

    const result = await reconcileOfflineMapRegions([region])

    expect(result).toEqual({
      regions: [region],
      changedRegions: 0,
      evictedTiles: 0,
    })
  })

  it('repairs a stale planned tile count without inventing cached progress', async () => {
    const region = {
      ...createOfflineMapRegion({
        name: 'Migrated field',
        tileSourceId: 'authorized-field-basemap',
        bounds,
        minZoom: 12,
        maxZoom: 13,
      }),
      tileCount: 999,
    }

    const result = await reconcileOfflineMapRegions([region])

    expect(result.changedRegions).toBe(1)
    expect(result.regions[0]).toMatchObject({
      status: 'planned',
      downloadedTiles: 0,
      tileCount: planRegionTiles(bounds, 12, 13).length,
    })
  })

  it('preserves cached tiles still referenced by another region', async () => {
    const first = createOfflineMapRegion({
      name: 'North field',
      tileSourceId: 'shared-source',
      bounds,
      minZoom: 12,
      maxZoom: 13,
    })
    const second = {
      ...createOfflineMapRegion({
        name: 'South field',
        tileSourceId: 'shared-source',
        bounds,
        minZoom: 12,
        maxZoom: 13,
      }),
      status: 'ready' as const,
    }
    await db.offlineMapRegions.bulkPut([first, second])
    const cache = await cacheStorage.open(mapCacheName(first.tileSourceId))
    const urls = planRegionTiles(
      first.bounds,
      first.minZoom,
      first.maxZoom,
    ).map((coordinate) => offlineTileCacheKey(first.tileSourceId, coordinate))
    for (const url of urls) {
      await cache.put(url, new Response('tile', { status: 200 }))
    }

    await deleteOfflineMapRegion(first)

    expect(await db.offlineMapRegions.get(first.id)).toBeUndefined()
    expect(await db.offlineMapRegions.get(second.id)).toBeDefined()
    await Promise.all(
      urls.map(async (url) => {
        expect(await cache.match(url)).toBeDefined()
      }),
    )

    await deleteOfflineMapRegion(second)
    await Promise.all(
      urls.map(async (url) => {
        expect(await cache.match(url)).toBeUndefined()
      }),
    )
  })
})
