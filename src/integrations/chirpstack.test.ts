import { describe, expect, it } from 'vitest'
import { normalizeChirpStackUplink } from './chirpstack'

const binding = {
  fieldId: '28f77310-f12d-4fd5-8097-3387e83fd49f',
  siteId: null,
  label: 'Bed 4',
  coordinate: {
    latitude: 39.7411,
    longitude: -104.9949,
    altitudeMeters: 1609,
    horizontalAccuracyMeters: 3,
    verticalAccuracyMeters: 5,
    headingDegrees: null,
  },
  measurements: [
    {
      key: 'soil.moisture',
      measurement: 'soil_moisture' as const,
      unit: '%',
      label: 'Bed 4 moisture',
      scale: 0.1,
    },
    {
      key: 'air.temperature',
      measurement: 'air_temperature' as const,
      unit: '°C',
    },
  ],
}

const uplink = {
  time: '2026-07-30T05:00:00.000Z',
  deviceInfo: {
    applicationId: 'aether-field',
    applicationName: 'Aether Field',
    deviceName: 'soil-001',
    devEui: '0102030405060708',
  },
  fCnt: 1432,
  fPort: 10,
  object: {
    soil: { moisture: 314 },
    air: { temperature: 24.6 },
  },
  rxInfo: [
    {
      gatewayId: 'aether-gw-weak',
      rssi: -110,
      snr: -2,
    },
    {
      gatewayId: 'aether-gw-01',
      rssi: -87,
      snr: 7.5,
      location: {
        latitude: 39.74,
        longitude: -104.99,
        altitude: 1610,
      },
    },
  ],
  txInfo: {
    frequency: 904300000,
    modulation: { lora: { spreadingFactor: 7 } },
  },
}

describe('ChirpStack integration', () => {
  it('normalizes decoded uplinks into typed field readings', () => {
    const readings = normalizeChirpStackUplink(uplink, binding)

    expect(readings).toHaveLength(2)
    expect(readings[0]).toMatchObject({
      label: 'Bed 4 moisture',
      measurement: 'soil_moisture',
      value: 31.4,
      unit: '%',
      quality: 'good',
      coordinate: {
        latitude: 39.74,
        longitude: -104.99,
      },
      lorawan: {
        devEui: '0102030405060708',
        rssi: -87,
        snr: 7.5,
        spreadingFactor: 7,
      },
    })
  })

  it('uses configured device location and estimated quality without gateway metadata', () => {
    const readings = normalizeChirpStackUplink(
      { ...uplink, rxInfo: [] },
      binding,
    )
    expect(readings[0].quality).toBe('estimated')
    expect(readings[0].coordinate).toEqual(binding.coordinate)
  })

  it('rejects malformed or undecoded uplinks', () => {
    expect(() =>
      normalizeChirpStackUplink({ ...uplink, object: undefined }, binding),
    ).toThrow()
  })
})
