import { describe, expect, it } from 'vitest'
import {
  coordinateSchema,
  fieldSchema,
  sensorReadingSchema,
} from './models'
import { demoFields, demoReadings, demoSnapshot } from './seed'

describe('field data contracts', () => {
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
