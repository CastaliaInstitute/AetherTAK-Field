// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SensorReading } from '../domain/models'
import { SensorMonitor } from './SensorMonitor'

const base: SensorReading = {
  id: '948e2cc8-67e5-4c27-b0de-00d98263869b',
  deviceId: 'cs-soil-01',
  fieldId: '67a61e3b-98ee-43ad-9ccd-cdc03de9ddad',
  siteId: null,
  label: 'Bed 1 moisture',
  measurement: 'soil_moisture',
  value: 42,
  unit: '%',
  quality: 'good',
  lorawan: {
    applicationId: 'farm',
    devEui: '0102030405060708',
    fPort: 10,
    frameCounter: 19,
    gatewayIds: ['barn'],
    rssi: -91,
    snr: 7.5,
    spreadingFactor: 7,
    frequencyHz: 915_200_000,
  },
  coordinate: {
    latitude: 39.74,
    longitude: -104.99,
    altitudeMeters: null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  recordedAt: '2026-07-30T11:55:00.000Z',
}

afterEach(cleanup)

describe('SensorMonitor', () => {
  it('shows one live channel for multiple historical samples', () => {
    render(
      <SensorMonitor
        now={new Date('2026-07-30T12:00:00.000Z')}
        readings={[
          { ...base, id: 'bceec64a-94c4-41e7-87aa-3bc5b53b0650', value: 40, recordedAt: '2026-07-30T11:40:00.000Z' },
          base,
        ]}
      />,
    )

    expect(screen.getByText('1 live / 1')).toBeInTheDocument()
    expect(screen.getByText('Bed 1 moisture')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText(/rising \+2\.00 %/)).toBeInTheDocument()
    expect(screen.getByText('0102030405060708')).toBeInTheDocument()
  })

  it('does not claim an old channel is live', () => {
    render(
      <SensorMonitor
        now={new Date('2026-07-30T15:00:00.000Z')}
        readings={[base]}
      />,
    )

    expect(screen.getByText('0 live / 1')).toBeInTheDocument()
    expect(screen.getByText(/offline · 3h ago/)).toBeInTheDocument()
  })
})
