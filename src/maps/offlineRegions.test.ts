import { describe, expect, it } from 'vitest'
import {
  createOfflineMapRegion,
  planRegionTiles,
  tileUrl,
} from './offlineRegions'

const bounds = {
  west: -104.9973,
  south: 39.7383,
  east: -104.9882,
  north: 39.743,
}

describe('offline map regions', () => {
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
})
