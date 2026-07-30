import { describe, expect, it } from 'vitest'
import {
  boundaryAreaHectares,
  boundaryCenter,
  normalizeBoundary,
  squareBoundaryMeters,
  stripClosingVertex,
} from './boundary'

describe('field boundaries', () => {
  it('removes duplicate neighbors and closes a valid polygon', () => {
    expect(normalizeBoundary([
      [-105, 40],
      [-104.999, 40],
      [-104.999, 40],
      [-104.999, 40.001],
      [-105, 40],
    ])).toEqual([
      [-105, 40],
      [-104.999, 40],
      [-104.999, 40.001],
      [-105, 40],
    ])
  })

  it('creates a latitude-correct 100 by 100 meter starter boundary', () => {
    const boundary = squareBoundaryMeters({
      latitude: 60,
      longitude: -105,
    })
    expect(boundaryAreaHectares(boundary)).toBeCloseTo(1, 3)
    const vertices = stripClosingVertex(boundary)
    const longitudeSpan = vertices[1][0] - vertices[0][0]
    const latitudeSpan = vertices[3][1] - vertices[0][1]
    expect(longitudeSpan).toBeCloseTo(latitudeSpan * 2, 4)
  })

  it('rejects too few, collinear, and self-intersecting vertices', () => {
    expect(() => normalizeBoundary([[-105, 40], [-104, 40]])).toThrow(
      'three distinct',
    )
    expect(() => normalizeBoundary([
      [-105, 40],
      [-104.5, 40],
      [-104, 40],
    ])).toThrow('enclose an area')
    expect(() => normalizeBoundary([
      [-105, 40],
      [-104, 41],
      [-105, 41],
      [-104, 40],
    ])).toThrow('cannot cross')
  })

  it('rejects invalid geographic coordinates', () => {
    expect(() => normalizeBoundary([
      [-181, 40],
      [-104, 40],
      [-104, 41],
    ])).toThrow('valid longitude and latitude')
  })

  it('calculates the polygon centroid', () => {
    const boundary = squareBoundaryMeters({
      latitude: 39.7406,
      longitude: -104.993,
    })
    expect(boundaryCenter(boundary)).toEqual({
      latitude: expect.closeTo(39.7406, 6),
      longitude: expect.closeTo(-104.993, 6),
    })
  })
})
