import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/database'
import { activityFromCot, recordInboundCot } from './activity'
import { operationToCot } from './cot'

const coordinate = {
  latitude: 39.7408,
  longitude: -104.9937,
  altitudeMeters: 1608,
  horizontalAccuracyMeters: 4,
  verticalAccuracyMeters: 7,
  headingDegrees: 82,
}

describe('durable TAK activity', () => {
  beforeEach(async () => {
    await db.takActivity.clear()
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it('classifies and persists an inbound route with its geometry', async () => {
    const xml = operationToCot({
      kind: 'route',
      uid: 'route-inbound-1',
      title: 'Creek inspection',
      colorArgb: -1,
      points: [
        coordinate,
        { ...coordinate, latitude: coordinate.latitude + 0.001 },
      ],
      createdAt: '2026-07-30T08:00:00.000Z',
    })

    const activity = await recordInboundCot(xml)
    expect(activity).toMatchObject({
      id: 'inbound:route-inbound-1',
      direction: 'inbound',
      kind: 'route',
      title: 'Creek inspection',
      deliveryStatus: 'received',
    })
    expect(activity.points).toHaveLength(2)
    expect(await db.takActivity.get(activity.id)).toEqual(activity)
  })

  it('extracts an inbound GeoChat sender and message', () => {
    const xml = operationToCot({
      kind: 'chat',
      uid: 'GeoChat.remote.local.1',
      sender: {
        uid: 'remote',
        callsign: 'Field Two',
        team: 'Green',
        role: 'Team Member',
      },
      recipientUid: 'local',
      conversationId: 'local',
      conversationName: 'Field One',
      message: 'Water level is rising',
      createdAt: '2026-07-30T08:02:00.000Z',
    })

    expect(activityFromCot(xml)).toMatchObject({
      kind: 'chat',
      title: 'Field Two',
      message: 'Water level is rising',
      direction: 'inbound',
    })
  })

  it('retains the inbound emergency type for field responders', () => {
    const xml = operationToCot({
      kind: 'emergency',
      uid: 'emergency-field-two',
      identity: {
        uid: 'field-two',
        callsign: 'Field Two',
        team: 'Green',
        role: 'Team Member',
      },
      coordinate,
      emergencyType: 'Medical',
      createdAt: '2026-07-30T08:03:00.000Z',
    })

    expect(activityFromCot(xml)).toMatchObject({
      kind: 'emergency',
      title: 'Medical',
      coordinate: {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      },
    })
  })
})
