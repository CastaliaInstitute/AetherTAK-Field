import { describe, expect, it } from 'vitest'
import {
  coordinateSchema,
  depthCapabilitySchema,
  depthScanResultSchema,
  fieldSchema,
  guardianParticipantStateSchema,
  guardianAlertSchema,
  mediaCaptureSchema,
  sensorReadingSchema,
  takContactSchema,
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

  it('accepts only bounded, renderable native TAK contacts', () => {
    const contact = {
      uid: 'peer-1',
      callsign: 'ATAK One',
      team: 'Green',
      coordinate: {
        latitude: 39.7408,
        longitude: -104.9937,
        altitudeMeters: 1608,
        horizontalAccuracyMeters: 4,
        verticalAccuracyMeters: 7,
        headingDegrees: 82,
      },
      staleAt: '2026-07-30T05:05:00.000Z',
    }

    expect(takContactSchema.parse(contact)).toEqual(contact)
    expect(
      takContactSchema.safeParse({
        ...contact,
        coordinate: { ...contact.coordinate, latitude: 91 },
      }).success,
    ).toBe(false)
    expect(
      takContactSchema.safeParse({ ...contact, staleAt: 'not-a-time' }).success,
    ).toBe(false)
    expect(
      takContactSchema.safeParse({ ...contact, callsign: 'x'.repeat(129) })
        .success,
    ).toBe(false)
  })

  it('rejects malformed or non-canonical media digests', () => {
    const media = {
      id: 'cd89c88b-85d5-47a1-8d79-bd1081d172b7',
      observationId: null,
      kind: 'video',
      localUri: 'file:///private/video.mp4',
      previewUri: null,
      mimeType: 'video/mp4',
      coordinate: demoSnapshot.properties[0].center,
      capturedAt: '2026-07-30T12:00:00.000Z',
      deviceModel: null,
      depthMetadata: null,
      syncState: 'queued',
    }
    expect(
      mediaCaptureSchema.parse({ ...media, sha256: 'a'.repeat(64) }).sha256,
    ).toBe('a'.repeat(64))
    expect(() =>
      mediaCaptureSchema.parse({ ...media, sha256: 'A'.repeat(64) }),
    ).toThrow()
    expect(() =>
      mediaCaptureSchema.parse({ ...media, sha256: 'not-a-digest' }),
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

  it('accepts bounded Guardian state and rejects biometric leakage', () => {
    const participant = demoSnapshot.guardianParticipants[0]
    expect(guardianParticipantStateSchema.parse(participant)).toEqual(
      participant,
    )
    expect(
      guardianParticipantStateSchema.safeParse({
        ...participant,
        heartRate: 82,
      }).success,
    ).toBe(false)
    expect(
      guardianParticipantStateSchema.safeParse({
        ...participant,
        location: {
          ...participant.location,
          coordinate: {
            ...participant.location.coordinate,
            heartRate: 82,
          },
        },
      }).success,
    ).toBe(false)
  })

  it('enforces Guardian alert lifecycle evidence', () => {
    const alert = demoSnapshot.guardianAlerts[0]
    expect(guardianAlertSchema.parse(alert)).toEqual(alert)
    expect(
      guardianAlertSchema.safeParse({
        ...alert,
        status: 'acknowledged',
        acknowledgedAt: null,
      }).success,
    ).toBe(false)
    expect(
      guardianAlertSchema.safeParse({
        ...alert,
        status: 'resolved',
        resolvedAt: '2026-07-30T18:30:00.000Z',
        resolutionReason: '',
      }).success,
    ).toBe(false)
    expect(
      guardianAlertSchema.safeParse({
        ...alert,
        context: { heartRate: 82 },
      }).success,
    ).toBe(false)
  })
})
