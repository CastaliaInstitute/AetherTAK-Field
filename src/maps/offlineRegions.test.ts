import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../data/database'
import {
  createOfflineMapRegion,
  deleteOfflineMapRegion,
  downloadOfflineMapRegion,
  mapCacheName,
  offlineMapStorageReserveBytes,
  planRegionTiles,
  tileUrl,
} from './offlineRegions'

const bounds = {
  west: -104.9973,
  south: 39.7383,
  east: -104.9882,
  north: 39.743,
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
      tileUrlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
      bounds,
      minZoom: 12,
      maxZoom: 15,
    })

    expect(region.tileCount).toBe(planRegionTiles(bounds, 12, 15).length)
    expect(region.status).toBe('planned')
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
  })

  it('persists a partial region and resumes without refetching cached tiles', async () => {
    const region = createOfflineMapRegion({
      name: 'Interrupted field',
      tileSourceId: 'authorized-field-basemap',
      tileUrlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
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
      tileUrlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
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
      tileUrlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
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
      tileUrlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
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
      tileUrlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
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

  it('preserves cached tiles still referenced by another region', async () => {
    const first = createOfflineMapRegion({
      name: 'North field',
      tileSourceId: 'shared-source',
      tileUrlTemplate: 'https://maps.example.test/{z}/{x}/{y}.png',
      bounds,
      minZoom: 12,
      maxZoom: 13,
    })
    const second = {
      ...createOfflineMapRegion({
        name: 'South field',
        tileSourceId: 'shared-source',
        tileUrlTemplate: first.tileUrlTemplate,
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
    ).map((coordinate) => tileUrl(first.tileUrlTemplate, coordinate))
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
