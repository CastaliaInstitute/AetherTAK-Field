import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/database'
import {
  activityFromCot,
  activityFromOperation,
  recordInboundCot,
} from './activity'
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

  it('applies a peer mission-package receipt to the durable outbound transfer', async () => {
    const sender = {
      uid: 'AETHER-FIELD-01',
      callsign: 'Field One',
      team: 'Green',
      role: 'Team Member' as const,
    }
    const operation = {
      kind: 'missionPackage' as const,
      uid: 'package-request-1',
      sender,
      recipientUid: 'ATAK-1',
      recipientCallsign: 'ATAK One',
      transferName: 'Field evidence',
      fileName: 'field-evidence.zip',
      localUri: 'file:///private/field-evidence.zip',
      storagePath: 'mission-packages/outbound/field-evidence.zip',
      coordinate,
      ackUid: 'package-ack-1',
      upload: {
        senderUrl:
          'https://tak.example.test:8443/Marti/api/sync/metadata/package',
        sha256: 'c'.repeat(64),
        sizeBytes: 2048,
      },
      createdAt: '2026-07-30T08:04:00.000Z',
    }
    await db.takActivity.put(
      activityFromOperation(
        operation,
        operationToCot(operation),
        'outbox-package-1',
      ),
    )
    await recordInboundCot(
      operationToCot({
        kind: 'missionPackageAck',
        uid: 'package-receipt-1',
        sender: { ...sender, uid: 'ATAK-1', callsign: 'ATAK One' },
        recipientCallsign: 'Field One',
        coordinate,
        ackUid: 'package-ack-1',
        transferName: 'Field evidence',
        sha256: 'c'.repeat(64),
        sizeBytes: 2048,
        success: true,
        reason: 'Transfer complete',
        createdAt: '2026-07-30T08:05:00.000Z',
      }),
    )
    expect(
      (await db.takActivity.get('outbound:package-request-1'))?.fileTransfer,
    ).toMatchObject({
      status: 'acknowledged',
      success: true,
      reason: 'Transfer complete',
    })
  })
})
