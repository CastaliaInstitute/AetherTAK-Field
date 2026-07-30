import { describe, expect, it } from 'vitest'
import {
  coordinateSchema,
  depthCapabilitySchema,
  depthScanResultSchema,
  fieldSchema,
  sensorReadingSchema,
} from './models'
import { demoFields, demoReadings, demoSnapshot } from './seed'

describe('field data contracts', () => {
  it('validates native depth capture results', () => {
    const result = depthScanResultSchema.parse({
      id: '3e3ed46b-290e-455a-a763-c59fab2a4321',
      provider: 'arkit-lidar',
      capturedAt: '2026-07-30T12:00:00.000Z',
      coordinate: {
        latitude: 40,
        longitude: -105,
        altitudeMeters: 1600,
        horizontalAccuracyMeters: 4,
        verticalAccuracyMeters: 8,
        headingDegrees: 180,
      },
      previewUri: 'file:///scan/preview.jpg',
      depthUri: 'file:///scan/depth.bin',
      confidenceUri: 'file:///scan/confidence.bin',
      pointCloudUri: 'file:///scan/cloud.ply',
      modelUri: null,
      measurements: [
        { label: 'Median range', value: 1.8, unit: 'm', uncertainty: 0.1 },
      ],
    })
    expect(result.provider).toBe('arkit-lidar')
  })

  it('rejects contradictory depth capability metadata', () => {
    expect(() =>
      depthCapabilitySchema.parse({
        supported: false,
        provider: 'arcore-depth',
        supportsPointCloud: false,
        supportsMesh: false,
        supportsConfidence: false,
        reason: 'Unavailable',
      }),
    ).toThrow()
  })

  it('validates seeded crop fields and closed map boundaries', () => {
    for (const field of demoFields) {
      expect(fieldSchema.parse(field)).toEqual(field)
      expect(field.boundary.at(0)).toEqual(field.boundary.at(-1))
    }
  })

  it('validates ChirpStack-normalized readings', () => {
    for (const reading of demoReadings) {
      expect(sensorReadingSchema.parse(reading)).toEqual(reading)
      expect(reading.deviceId).toMatch(/^cs-/)
    }
  })

  it('rejects impossible geographic coordinates', () => {
    expect(() =>
      coordinateSchema.parse({
        latitude: 91,
        longitude: -104,
        altitudeMeters: null,
        horizontalAccuracyMeters: null,
        verticalAccuracyMeters: null,
        headingDegrees: null,
      }),
    ).toThrow()
  })

  it('keeps the Al contact consistently capitalized', () => {
    expect(demoSnapshot.contacts.some((contact) => contact.callsign === 'Al')).toBe(
      true,
    )
    expect(
      demoSnapshot.contacts.some((contact) => contact.callsign === 'al'),
    ).toBe(false)
  })
})
