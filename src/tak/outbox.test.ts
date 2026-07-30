import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/database'
import {
  markTakEventFailed,
  markTakEventSent,
  pendingTakEvents,
  queueTakOperation,
} from './outbox'

const marker = {
  kind: 'marker' as const,
  uid: 'marker-offline-1',
  callsign: 'Soil sample',
  coordinate: {
    latitude: 39.74,
    longitude: -104.99,
    altitudeMeters: null,
    horizontalAccuracyMeters: 3,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  remarks: 'Sample A-14',
  createdAt: '2026-07-30T05:00:00.000Z',
}

describe('offline TAK outbox', () => {
  beforeEach(async () => {
    await db.takOutbox.clear()
    await db.takActivity.clear()
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it('persists encoded CoT until delivery succeeds', async () => {
    const queued = await queueTakOperation(marker)
    expect((await pendingTakEvents())[0].xml).toContain('Sample A-14')
    expect((await db.takActivity.get('outbound:marker-offline-1'))?.deliveryStatus)
      .toBe('queued')

    await markTakEventFailed(queued.id, 'offline')
    expect((await db.takOutbox.get(queued.id))?.attempts).toBe(1)
    expect((await db.takActivity.get('outbound:marker-offline-1'))?.deliveryStatus)
      .toBe('failed')

    await markTakEventSent(queued.id)
    expect(await pendingTakEvents()).toEqual([])
    expect((await db.takActivity.get('outbound:marker-offline-1'))?.deliveryStatus)
      .toBe('sent')
  })

  it('coalesces unsent position updates for the same TAK identity', async () => {
    const identity = {
      uid: 'AETHER-FIELD-01',
      callsign: 'Field One',
      team: 'Green',
      role: 'Team Member' as const,
    }
    const first = await queueTakOperation({
      kind: 'position',
      uid: identity.uid,
      identity,
      coordinate: marker.coordinate,
      createdAt: '2026-07-30T05:00:00.000Z',
    })
    const second = await queueTakOperation({
      kind: 'position',
      uid: identity.uid,
      identity,
      coordinate: { ...marker.coordinate, latitude: 39.75 },
      createdAt: '2026-07-30T05:00:15.000Z',
    })

    expect(await db.takOutbox.get(first.id)).toBeUndefined()
    expect((await pendingTakEvents())).toHaveLength(1)
    expect((await db.takOutbox.get(second.id))?.operation).toMatchObject({
      kind: 'position',
      coordinate: { latitude: 39.75 },
    })
  })
})
