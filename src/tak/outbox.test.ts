import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../data/database'
import {
  flushTakOutbox,
  markTakEventFailed,
  markTakEventSent,
  pendingTakEvents,
  queueTakOperation,
} from './outbox'
import { takTransport } from '../platform/tak'

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

  it('uploads a queued mission package once before sending its durable CoT request', async () => {
    const upload = vi.spyOn(takTransport, 'uploadMissionPackage')
      .mockResolvedValue({
        senderUrl:
          'https://tak.example.test:8443/Marti/api/sync/metadata/package',
        sha256: 'b'.repeat(64),
        sizeBytes: 2048,
      })
    const send = vi.spyOn(takTransport, 'sendXml').mockResolvedValue(true)
    const queued = await queueTakOperation({
      kind: 'missionPackage',
      uid: 'package-request-1',
      sender: {
        uid: 'AETHER-FIELD-01',
        callsign: 'Field One',
        team: 'Green',
        role: 'Team Member',
      },
      recipientUid: 'ATAK-1',
      recipientCallsign: 'ATAK One',
      transferName: 'Field evidence',
      fileName: 'field-evidence.zip',
      localUri: 'file:///private/field-evidence.zip',
      storagePath: 'mission-packages/outbound/field-evidence.zip',
      coordinate: marker.coordinate,
      ackUid: 'package-ack-1',
      upload: null,
      createdAt: marker.createdAt,
    })
    expect(queued.xml).toBe('')

    expect(await flushTakOutbox()).toMatchObject({
      sent: 1,
      failed: 0,
      remaining: 0,
    })
    expect(upload).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('<fileshare filename="field-evidence.zip"'),
    )
    expect((await db.takActivity.get('outbound:package-request-1'))
      ?.fileTransfer).toMatchObject({
        sha256: 'b'.repeat(64),
        sizeBytes: 2048,
      })
  })
})
