import { describe, expect, it } from 'vitest'
import type { TakActivity } from './activity'
import {
  isTakActivityLive,
  liveTakActivity,
} from './staleness'

const activity = (id: string, staleAt: string): TakActivity => ({
  id,
  uid: id,
  outboxId: null,
  direction: 'inbound',
  kind: 'marker',
  title: id,
  message: null,
  coordinate: {
    latitude: 39,
    longitude: -105,
    altitudeMeters: null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  points: [],
  closed: null,
  fileTransfer: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  staleAt,
  deliveryStatus: 'received',
  xml: '<event/>',
})

describe('TAK operational staleness', () => {
  const now = Date.parse('2026-07-30T10:05:00.000Z')

  it('keeps only events whose CoT stale time is in the future', () => {
    const live = activity('live', '2026-07-30T10:05:00.001Z')
    const expired = activity('expired', '2026-07-30T10:05:00.000Z')

    expect(isTakActivityLive(live, now)).toBe(true)
    expect(isTakActivityLive(expired, now)).toBe(false)
    expect(liveTakActivity([expired, live], now)).toEqual([live])
  })

  it('fails closed for malformed or non-finite clock values', () => {
    expect(isTakActivityLive(activity('bad', 'not-a-date'), now)).toBe(false)
    expect(
      isTakActivityLive(
        activity('future', '2026-07-30T10:06:00.000Z'),
        Number.NaN,
      ),
    ).toBe(false)
  })
})
