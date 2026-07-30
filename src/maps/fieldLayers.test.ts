import { describe, expect, it } from 'vitest'
import type { Alert, AlInsight, Observation } from '../domain/models'
import {
  demoEcologicalSites,
  demoFields,
  demoGuardianParticipants,
  demoInsights,
  demoReadings,
} from '../domain/seed'
import {
  alertCollection,
  ecologicalSiteCollection,
  fieldCollection,
  formatSensorValue,
  guardianParticipantCollection,
  guardianUncertaintyCollection,
  insightCollection,
  observationCollection,
  readingCollection,
} from './fieldLayers'

describe('operational field map layers', () => {
  it('closes imported field geometry and excludes invalid polygons', () => {
    const openField = {
      ...demoFields[0],
      boundary: demoFields[0].boundary.slice(0, -1),
    }
    const invalidField = {
      ...demoFields[1],
      id: '813d30ac-7dd0-49a8-9d74-2b693a984aa1',
      boundary: [[-105, 40], [-104.5, 40], [-104, 40]] as Array<
        [number, number]
      >,
    }
    const collection = fieldCollection([openField, invalidField])

    expect(collection.features).toHaveLength(1)
    const coordinates = collection.features[0].geometry.type === 'Polygon'
      ? collection.features[0].geometry.coordinates[0]
      : []
    expect(coordinates[0]).toEqual(coordinates.at(-1))
    expect(collection.features[0].properties).toMatchObject({
      title: openField.name,
      icon: openField.cropIcon,
    })
  })

  it('maps ecological boundaries with condition and habitat symbols', () => {
    const collection = ecologicalSiteCollection(demoEcologicalSites)

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].geometry.type).toBe('Polygon')
    expect(collection.features[0].properties).toMatchObject({
      title: demoEcologicalSites[0].name,
      eyebrow: 'Ecological site',
      icon: '🌿',
    })
    expect(collection.features[0].properties?.detail).toContain('condition')
  })

  it('formats current sensor data into readable map labels', () => {
    expect(formatSensorValue({
      ...demoReadings[0],
      value: 7.123,
      unit: 'pH',
    })).toBe('7.12 pH')
    const collection = readingCollection(demoReadings)
    expect(collection.features[0].properties?.valueLabel).toBe('31.4 %')
    expect(collection.features[0].properties?.detail).toContain(
      'soil moisture',
    )
  })

  it('maps offline evidence with a category-specific symbol', () => {
    const observation: Observation = {
      id: 'd81a20f2-d637-4f36-9341-4c18bac482cc',
      fieldId: demoFields[0].id,
      siteId: null,
      category: 'damage',
      title: 'Hail injury',
      notes: '',
      coordinate: demoReadings[0].coordinate,
      observedAt: '2026-07-30T12:00:00.000Z',
      mediaIds: ['cf3ac6c7-82ea-4e15-a8e3-235959d62be0'],
      syncState: 'queued',
    }
    const collection = observationCollection([observation])

    expect(collection.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [
        observation.coordinate.longitude,
        observation.coordinate.latitude,
      ],
    })
    expect(collection.features[0].properties).toMatchObject({
      title: 'Hail injury',
      icon: '⚠',
    })
  })

  it('anchors alerts to their sensor before falling back to field geometry', () => {
    const sensorAlert: Alert = {
      id: '70a890ed-eafa-4d74-b5dc-f451c08ef9f5',
      severity: 'critical',
      title: 'Probe alarm',
      detail: 'Review now.',
      fieldId: demoFields[1].id,
      deviceId: demoReadings[0].deviceId,
      createdAt: '2026-07-30T12:00:00.000Z',
      acknowledgedAt: null,
      syncState: 'synced',
    }
    const collection = alertCollection(
      [sensorAlert, { ...sensorAlert, id: 'a8821184-fcd0-4c47-9151-1c1bbec5ce7e', deviceId: null }],
      demoFields,
      demoReadings,
    )

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [
        demoReadings[0].coordinate.longitude,
        demoReadings[0].coordinate.latitude,
      ],
    })
    expect(collection.features[1].geometry).not.toEqual(
      collection.features[0].geometry,
    )
  })

  it('anchors read-only Al insights to fields or ecological sites', () => {
    const siteInsight: AlInsight = {
      ...demoInsights[0],
      id: 'c9fb0bde-60f5-4e6f-b9ab-52e9ce1ee18b',
      fieldId: null,
      siteId: demoEcologicalSites[0].id,
    }
    const collection = insightCollection(
      [demoInsights[0], siteInsight],
      demoFields,
      demoEcologicalSites,
    )

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0].properties?.eyebrow).toBe(
      'Al read-only insight',
    )
    expect(collection.features[1].geometry).toEqual({
      type: 'Point',
      coordinates: [
        demoEcologicalSites[0].center.longitude,
        demoEcologicalSites[0].center.latitude,
      ],
    })
  })

  it('maps Guardian participants with explicit source and uncertainty', () => {
    const participant = demoGuardianParticipants[0]
    const points = guardianParticipantCollection([participant])
    const uncertainty = guardianUncertaintyCollection([participant])

    expect(points.features[0].properties).toMatchObject({
      title: participant.displayName,
      source: 'watch_gnss',
      confidence: 'good',
      accuracyMeters: 8,
    })
    expect(points.features[0].properties?.detail).toContain('Watch GPS')
    expect(points.features[0].properties?.detail).toContain('8 m uncertainty')
    expect(uncertainty.features[0].geometry.type).toBe('Polygon')
    const ring =
      uncertainty.features[0].geometry.type === 'Polygon'
        ? uncertainty.features[0].geometry.coordinates[0]
        : []
    expect(ring).toHaveLength(33)
    expect(ring[0]).toEqual(ring.at(-1))
  })

  it('uses conservative uncertainty when a Guardian source has no accuracy', () => {
    const participant = {
      ...demoGuardianParticipants[0],
      location: {
        ...demoGuardianParticipants[0].location,
        source: 'ble_presence' as const,
        confidence: 'estimated' as const,
        coordinate: {
          ...demoGuardianParticipants[0].location.coordinate,
          horizontalAccuracyMeters: null,
        },
      },
    }
    const point = guardianParticipantCollection([participant]).features[0]

    expect(point.properties).toMatchObject({
      source: 'ble_presence',
      accuracyMeters: 100,
    })
    expect(point.properties?.detail).toContain('BLE zone presence')
  })
})
