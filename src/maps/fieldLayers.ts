import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import {
  boundaryCenter,
  normalizeBoundary,
} from '../domain/boundary'
import type {
  Alert,
  AlInsight,
  EcologicalSite,
  Field,
  Observation,
  SensorReading,
} from '../domain/models'

type MapPointFeature = Feature<Point, Record<string, string | number>>
type MapPolygonFeature = Feature<Polygon, Record<string, string | number>>

function pointFeature(
  longitude: number,
  latitude: number,
  properties: MapPointFeature['properties'],
): MapPointFeature {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
  }
}

function polygonFeature(
  boundary: Array<[number, number]>,
  properties: MapPolygonFeature['properties'],
): MapPolygonFeature {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [normalizeBoundary(boundary)],
    },
  }
}

export function fieldCollection(fields: Field[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fields.flatMap((field) => {
      try {
        return [polygonFeature(field.boundary, {
          id: field.id,
          title: field.name,
          eyebrow: 'Crop field',
          detail: [
            field.crop,
            field.variety,
            field.status,
            field.healthScore === null ? null : `${field.healthScore}% health`,
          ].filter(Boolean).join(' · '),
          icon: field.cropIcon,
          status: field.status,
        })]
      } catch {
        return []
      }
    }),
  }
}

function ecologicalIcon(siteType: EcologicalSite['siteType']) {
  switch (siteType) {
    case 'wetland':
    case 'water':
      return '💧'
    case 'woodland':
      return '🌳'
    case 'grassland':
      return '🌾'
    case 'pollinator':
      return '🐝'
    case 'soil':
      return '🪱'
    default:
      return '🌿'
  }
}

export function ecologicalSiteCollection(
  sites: EcologicalSite[],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sites.flatMap((site) => {
      try {
        return [polygonFeature(site.boundary, {
          id: site.id,
          title: site.name,
          eyebrow: 'Ecological site',
          detail: [
            site.siteType,
            site.conditionScore === null
              ? null
              : `${site.conditionScore}% condition`,
            site.indicatorSpecies.length === 0
              ? null
              : `${site.indicatorSpecies.length} indicator species`,
          ].filter(Boolean).join(' · '),
          icon: ecologicalIcon(site.siteType),
          siteType: site.siteType,
        })]
      } catch {
        return []
      }
    }),
  }
}

export function formatSensorValue(reading: SensorReading) {
  const magnitude = Math.abs(reading.value)
  const precision = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2
  return `${Number(reading.value.toFixed(precision))} ${reading.unit}`
}

export function readingCollection(
  readings: SensorReading[],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: readings.map((reading) => {
      const valueLabel = formatSensorValue(reading)
      return pointFeature(
        reading.coordinate.longitude,
        reading.coordinate.latitude,
        {
          id: reading.id,
          title: reading.label,
          eyebrow: reading.lorawan ? 'LoRaWAN sensor' : 'Field sensor',
          detail: `${valueLabel} · ${reading.measurement.replaceAll('_', ' ')} · ${reading.quality}`,
          valueLabel,
          quality: reading.quality,
        },
      )
    }),
  }
}

function observationIcon(category: Observation['category']) {
  switch (category) {
    case 'crop':
      return '🌱'
    case 'species':
      return '🐾'
    case 'habitat':
      return '🌿'
    case 'water':
      return '💧'
    case 'soil':
      return '🪱'
    case 'damage':
      return '⚠'
  }
}

export function observationCollection(
  observations: Observation[],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: observations.map((observation) =>
      pointFeature(
        observation.coordinate.longitude,
        observation.coordinate.latitude,
        {
          id: observation.id,
          title: observation.title,
          eyebrow: 'Field evidence',
          detail: [
            observation.category,
            `${observation.mediaIds.length} media`,
            new Date(observation.observedAt).toLocaleDateString(),
          ].join(' · '),
          icon: observationIcon(observation.category),
          category: observation.category,
        },
      )),
  }
}

function fieldCoordinate(field: Field | undefined) {
  if (!field) return null
  try {
    return boundaryCenter(field.boundary)
  } catch {
    return null
  }
}

export function alertCollection(
  alerts: Alert[],
  fields: Field[],
  readings: SensorReading[],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: alerts.flatMap((alert) => {
      const sensor = alert.deviceId
        ? readings.find((reading) => reading.deviceId === alert.deviceId)
        : undefined
      const coordinate = sensor?.coordinate ??
        fieldCoordinate(fields.find((field) => field.id === alert.fieldId))
      if (!coordinate) return []
      return [pointFeature(coordinate.longitude, coordinate.latitude, {
        id: alert.id,
        title: alert.title,
        eyebrow: `${alert.severity} alert`,
        detail: alert.detail,
        severity: alert.severity,
        acknowledged: alert.acknowledgedAt ? 1 : 0,
      })]
    }),
  }
}

export function insightCollection(
  insights: AlInsight[],
  fields: Field[],
  sites: EcologicalSite[],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: insights.flatMap((insight) => {
      const field = fields.find((item) => item.id === insight.fieldId)
      const site = sites.find((item) => item.id === insight.siteId)
      const coordinate = fieldCoordinate(field) ?? site?.center
      if (!coordinate) return []
      return [pointFeature(coordinate.longitude, coordinate.latitude, {
        id: insight.id,
        title: insight.title,
        eyebrow: 'Al read-only insight',
        detail: insight.summary,
        severity: insight.severity,
      })]
    }),
  }
}
