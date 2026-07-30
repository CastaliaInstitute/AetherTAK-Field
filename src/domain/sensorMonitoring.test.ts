import { describe, expect, it } from 'vitest'
import type { SensorReading } from './models'
import {
  buildSensorChannels,
  SENSOR_LIVE_WINDOW_MS,
  SENSOR_STALE_WINDOW_MS,
} from './sensorMonitoring'

const now = new Date('2026-07-30T12:00:00.000Z')

function reading(
  overrides: Partial<SensorReading> & Pick<SensorReading, 'id' | 'recordedAt' | 'value'>,
): SensorReading {
  return {
    deviceId: 'soil-1',
    fieldId: '67a61e3b-98ee-43ad-9ccd-cdc03de9ddad',
    siteId: null,
    label: 'North soil moisture',
    measurement: 'soil_moisture',
    unit: '%',
    quality: 'good',
    lorawan: null,
    coordinate: {
      latitude: 39.74,
      longitude: -104.99,
      altitudeMeters: null,
      horizontalAccuracyMeters: null,
      verticalAccuracyMeters: null,
      headingDegrees: null,
    },
    ...overrides,
  }
}

describe('sensor channel monitoring', () => {
  it('collapses history into one latest channel and calculates a trend', () => {
    const channels = buildSensorChannels([
      reading({
        id: '7dfcfeac-c104-4a69-8a79-8c141a9b56b8',
        recordedAt: '2026-07-30T11:40:00.000Z',
        value: 30,
      }),
      reading({
        id: '5f25cffd-296b-44b1-9860-af9138a04af1',
        recordedAt: '2026-07-30T11:55:00.000Z',
        value: 34.5,
      }),
    ], now)

    expect(channels).toHaveLength(1)
    expect(channels[0].latest.value).toBe(34.5)
    expect(channels[0].previous?.value).toBe(30)
    expect(channels[0].sampleCount).toBe(2)
    expect(channels[0].trend).toBe('rising')
    expect(channels[0].delta).toBe(4.5)
    expect(channels[0].freshness).toBe('live')
  })

  it('separates measurements from the same physical device', () => {
    const common = {
      recordedAt: '2026-07-30T11:59:00.000Z',
      value: 18,
    }
    const channels = buildSensorChannels([
      reading({
        ...common,
        id: '3c13d1ef-0b33-4179-9829-e28dd6459410',
        measurement: 'soil_temperature',
        unit: '°C',
      }),
      reading({
        ...common,
        id: 'd7cc8850-b566-461d-ac27-29890c0f2185',
        measurement: 'soil_moisture',
      }),
    ], now)

    expect(channels).toHaveLength(2)
  })

  it('uses explicit live, stale, and offline windows', () => {
    const atAge = (age: number, id: string) =>
      reading({
        id,
        recordedAt: new Date(now.getTime() - age).toISOString(),
        value: 1,
      })

    expect(buildSensorChannels([
      atAge(SENSOR_LIVE_WINDOW_MS, '301708c0-4a1c-4a3e-93b3-56b36bac6364'),
    ], now)[0].freshness).toBe('live')
    expect(buildSensorChannels([
      atAge(SENSOR_LIVE_WINDOW_MS + 1, '812858a1-269f-4ee5-9043-49f835603dca'),
    ], now)[0].freshness).toBe('stale')
    expect(buildSensorChannels([
      atAge(SENSOR_STALE_WINDOW_MS + 1, '94d49c48-ea36-4c22-9a70-0ec584333d23'),
    ], now)[0].freshness).toBe('offline')
  })
})
