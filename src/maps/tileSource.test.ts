import { describe, expect, it } from 'vitest'
import {
  parseProtocolTileUrl,
  protocolTileUrl,
  rasterStyleUrl,
} from './tileSource'

describe('MapLibre offline raster protocol', () => {
  it('round-trips tile coordinates and source identity', () => {
    const url = protocolTileUrl('authorized-field-map', {
      z: 15,
      x: 6826,
      y: 12415,
    })
    expect(parseProtocolTileUrl(url)).toEqual({
      sourceId: 'authorized-field-map',
      coordinate: { z: 15, x: 6826, y: 12415 },
    })
  })

  it('produces a MapLibre tile template', () => {
    expect(
      rasterStyleUrl({
        id: 'field',
        urlTemplate: 'https://maps.test/{z}/{x}/{y}.png',
        attribution: 'Test',
        allowOfflineDownload: true,
      }),
    ).toBe('aether-raster://field/{z}/{x}/{y}')
  })

  it('rejects malformed coordinates and other protocols', () => {
    expect(() =>
      parseProtocolTileUrl('https://maps.test/1/2/3'),
    ).toThrow('Unsupported')
    expect(() =>
      parseProtocolTileUrl('aether-raster://field/z/2/3'),
    ).toThrow('Invalid')
  })
})
