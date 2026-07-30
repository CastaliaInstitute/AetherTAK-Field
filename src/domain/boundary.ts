import type { Coordinate } from './models'

export type BoundaryPoint = [longitude: number, latitude: number]

const EARTH_RADIUS_METERS = 6_371_008.8
const DEGREES_TO_RADIANS = Math.PI / 180
const MINIMUM_AREA_SQUARE_METERS = 0.01

function samePoint(left: BoundaryPoint, right: BoundaryPoint) {
  return left[0] === right[0] && left[1] === right[1]
}

function assertPoint([longitude, latitude]: BoundaryPoint) {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error('Boundary coordinates must contain valid longitude and latitude.')
  }
}

export function stripClosingVertex(boundary: BoundaryPoint[]) {
  const vertices = boundary.map((point) => [...point] as BoundaryPoint)
  while (
    vertices.length > 1 &&
    samePoint(vertices[0], vertices[vertices.length - 1])
  ) {
    vertices.pop()
  }
  return vertices
}

function projectedVertices(boundary: BoundaryPoint[]) {
  const vertices = stripClosingVertex(boundary)
  if (vertices.length === 0) return []
  const referenceLatitude =
    vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length
  const longitudeScale =
    EARTH_RADIUS_METERS *
    DEGREES_TO_RADIANS *
    Math.cos(referenceLatitude * DEGREES_TO_RADIANS)
  const latitudeScale = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS
  return vertices.map(([longitude, latitude]) => [
    longitude * longitudeScale,
    latitude * latitudeScale,
  ] as BoundaryPoint)
}

function signedAreaSquareMeters(boundary: BoundaryPoint[]) {
  const vertices = projectedVertices(boundary)
  if (vertices.length < 3) return 0
  return vertices.reduce((area, point, index) => {
    const next = vertices[(index + 1) % vertices.length]
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2
}

export function boundaryAreaHectares(boundary: BoundaryPoint[]) {
  return Math.abs(signedAreaSquareMeters(boundary)) / 10_000
}

function orientation(
  first: BoundaryPoint,
  second: BoundaryPoint,
  third: BoundaryPoint,
) {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  )
}

function pointOnSegment(
  point: BoundaryPoint,
  start: BoundaryPoint,
  end: BoundaryPoint,
) {
  const epsilon = 1e-12
  return (
    Math.abs(orientation(start, end, point)) <= epsilon &&
    point[0] >= Math.min(start[0], end[0]) - epsilon &&
    point[0] <= Math.max(start[0], end[0]) + epsilon &&
    point[1] >= Math.min(start[1], end[1]) - epsilon &&
    point[1] <= Math.max(start[1], end[1]) + epsilon
  )
}

function segmentsIntersect(
  firstStart: BoundaryPoint,
  firstEnd: BoundaryPoint,
  secondStart: BoundaryPoint,
  secondEnd: BoundaryPoint,
) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart)
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd)
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart)
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd)

  if (
    ((firstOrientation > 0 && secondOrientation < 0) ||
      (firstOrientation < 0 && secondOrientation > 0)) &&
    ((thirdOrientation > 0 && fourthOrientation < 0) ||
      (thirdOrientation < 0 && fourthOrientation > 0))
  ) {
    return true
  }

  return (
    pointOnSegment(secondStart, firstStart, firstEnd) ||
    pointOnSegment(secondEnd, firstStart, firstEnd) ||
    pointOnSegment(firstStart, secondStart, secondEnd) ||
    pointOnSegment(firstEnd, secondStart, secondEnd)
  )
}

function hasSelfIntersection(vertices: BoundaryPoint[]) {
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length
      const adjacent =
        first === second ||
        firstNext === second ||
        secondNext === first
      if (adjacent) continue
      if (
        segmentsIntersect(
          vertices[first],
          vertices[firstNext],
          vertices[second],
          vertices[secondNext],
        )
      ) {
        return true
      }
    }
  }
  return false
}

export function normalizeBoundary(boundary: BoundaryPoint[]) {
  const vertices: BoundaryPoint[] = []
  for (const input of stripClosingVertex(boundary)) {
    const point = [...input] as BoundaryPoint
    assertPoint(point)
    if (
      vertices.length === 0 ||
      !samePoint(vertices[vertices.length - 1], point)
    ) {
      vertices.push(point)
    }
  }

  const distinct = new Set(vertices.map(([longitude, latitude]) =>
    `${longitude},${latitude}`))
  if (vertices.length < 3 || distinct.size < 3) {
    throw new Error('Add at least three distinct boundary vertices.')
  }
  if (hasSelfIntersection(vertices)) {
    throw new Error('Boundary edges cannot cross each other.')
  }
  if (
    Math.abs(signedAreaSquareMeters(vertices)) < MINIMUM_AREA_SQUARE_METERS
  ) {
    throw new Error('Boundary vertices must enclose an area.')
  }
  return [...vertices, [...vertices[0]] as BoundaryPoint]
}

export function squareBoundaryMeters(
  center: Pick<Coordinate, 'latitude' | 'longitude'>,
  halfWidthMeters = 50,
) {
  if (!Number.isFinite(halfWidthMeters) || halfWidthMeters <= 0) {
    throw new Error('Starter boundary size must be positive.')
  }
  assertPoint([center.longitude, center.latitude])
  const latitudeOffset =
    halfWidthMeters / (EARTH_RADIUS_METERS * DEGREES_TO_RADIANS)
  const longitudeMetersPerDegree =
    EARTH_RADIUS_METERS *
    DEGREES_TO_RADIANS *
    Math.cos(center.latitude * DEGREES_TO_RADIANS)
  if (Math.abs(longitudeMetersPerDegree) < 1e-8) {
    throw new Error('A starter boundary cannot be created at this latitude.')
  }
  const longitudeOffset = halfWidthMeters / longitudeMetersPerDegree
  return normalizeBoundary([
    [center.longitude - longitudeOffset, center.latitude - latitudeOffset],
    [center.longitude + longitudeOffset, center.latitude - latitudeOffset],
    [center.longitude + longitudeOffset, center.latitude + latitudeOffset],
    [center.longitude - longitudeOffset, center.latitude + latitudeOffset],
  ])
}

export function boundaryCenter(
  boundary: BoundaryPoint[],
): Pick<Coordinate, 'latitude' | 'longitude'> {
  const vertices = stripClosingVertex(normalizeBoundary(boundary))
  const projected = projectedVertices(vertices)
  const signedArea = projected.reduce((area, point, index) => {
    const next = projected[(index + 1) % projected.length]
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2
  let longitudeWeighted = 0
  let latitudeWeighted = 0
  projected.forEach((point, index) => {
    const next = projected[(index + 1) % projected.length]
    const cross = point[0] * next[1] - next[0] * point[1]
    longitudeWeighted += (point[0] + next[0]) * cross
    latitudeWeighted += (point[1] + next[1]) * cross
  })
  const referenceLatitude =
    vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length
  const longitudeScale =
    EARTH_RADIUS_METERS *
    DEGREES_TO_RADIANS *
    Math.cos(referenceLatitude * DEGREES_TO_RADIANS)
  const latitudeScale = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS
  return {
    longitude: longitudeWeighted / (6 * signedArea) / longitudeScale,
    latitude: latitudeWeighted / (6 * signedArea) / latitudeScale,
  }
}
