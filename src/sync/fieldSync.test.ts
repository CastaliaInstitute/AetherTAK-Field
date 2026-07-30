import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queueMutation } from '../data/database'
import type { Property } from '../domain/models'
import { demoSnapshot } from '../domain/seed'
import type { NativeFieldResponse } from '../platform/tak'
import { flushFieldOutbox, pullFieldChanges } from './fieldSync'

const property: Property = {
  id: '7280b290-7607-4904-9004-ee767ac3cf84',
  name: 'Test Farm',
  description: '',
  center: {
    latitude: 40,
    longitude: -105,
    altitudeMeters: null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  },
  boundary: [
    [-105, 40],
    [-104.9, 40],
    [-105, 40.1],
  ],
  timezone: 'America/Denver',
  updatedAt: '2026-07-30T06:00:00.000Z',
  syncState: 'queued',
}

function accepted(itemId: string): NativeFieldResponse {
  return {
    status: 200,
    body: {
      accepted: true,
      mutationId: itemId,
      entityType: 'property',
      entityId: property.id,
      revision: 1,
      cursor: 1,
      serverUpdatedAt: '2026-07-30T06:45:00.000Z',
      idempotentReplay: false,
    },
  }
}

describe('Aether Field durable synchronization', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.properties.add(property)
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it('records the server revision and removes an accepted mutation', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'create',
      payload: property,
    })
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(async () => accepted(queued.id)),
      changes: vi.fn(),
    }

    expect(await flushFieldOutbox(100, transport)).toEqual({
      sent: 1,
      conflicts: 0,
      failed: 0,
      remaining: 0,
    })
    expect((await db.properties.get(property.id))?.syncState).toBe('synced')
    expect(
      (await db.syncMetadata.get(`property:${property.id}`))?.revision,
    ).toBe(1)
  })

  it('backs off after an offline failure without losing the mutation', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'create',
      payload: property,
    })
    const now = new Date(queued.createdAt)
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(async () => {
        throw new Error('offline')
      }),
      changes: vi.fn(),
    }

    const result = await flushFieldOutbox(100, transport, now)
    const retained = await db.outbox.get(queued.id)
    expect(result.failed).toBe(1)
    expect(retained?.attempts).toBe(1)
    expect(new Date(retained!.nextAttemptAt).getTime()).toBeGreaterThan(
      now.getTime(),
    )
  })

  it('preserves both versions and marks a stale edit as conflict', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'create',
      payload: property,
    })
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(async () => ({
        status: 409,
        body: {
          error: {
            current: {
              entityType: 'property',
              entityId: property.id,
              revision: 2,
              deleted: false,
              payload: { ...property, name: 'Server Farm' },
              updatedAt: '2026-07-30T06:44:00.000Z',
              author: 'Al',
            },
          },
        },
      })),
      changes: vi.fn(),
    }

    const result = await flushFieldOutbox(100, transport)
    expect(result.conflicts).toBe(1)
    expect((await db.outbox.get(queued.id))?.conflict?.revision).toBe(2)
    expect((await db.properties.get(property.id))?.syncState).toBe('conflict')
  })

  it('hydrates a remote property and advances the durable cursor', async () => {
    const remote = { ...property, name: 'Remote Farm', syncState: 'synced' }
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [
            {
              cursor: 7,
              entityType: 'property',
              entityId: property.id,
              revision: 3,
              operation: 'update',
              payload: remote,
              serverUpdatedAt: '2026-07-30T07:00:00.000Z',
              author: 'Al',
            },
          ],
          nextCursor: 7,
          hasMore: false,
        },
      })),
    }

    expect(await pullFieldChanges(transport)).toEqual({
      applied: 1,
      conflicts: 0,
      pages: 1,
      cursor: 7,
    })
    expect((await db.properties.get(property.id))?.name).toBe('Remote Farm')
    expect((await db.syncControl.get('field'))?.cursor).toBe(7)
    expect(
      (await db.syncMetadata.get(`property:${property.id}`))?.revision,
    ).toBe(3)
  })

  it('hydrates publisher-managed sensor readings and read-only Al insights', async () => {
    const reading = {
      ...demoSnapshot.readings[0],
      value: 31.7,
      recordedAt: '2026-07-30T07:10:00.000Z',
    }
    const insight = {
      ...demoSnapshot.insights[0],
      title: 'Inspect irrigation pressure',
      generatedAt: '2026-07-30T07:11:00.000Z',
      expiresAt: '2026-07-31T07:11:00.000Z',
    }
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [
            {
              cursor: 10,
              entityType: 'sensor_reading',
              entityId: reading.id,
              revision: 1,
              operation: 'create',
              payload: reading,
              serverUpdatedAt: '2026-07-30T07:10:01.000Z',
              author: 'ChirpStack',
            },
            {
              cursor: 11,
              entityType: 'al_insight',
              entityId: insight.id,
              revision: 1,
              operation: 'create',
              payload: insight,
              serverUpdatedAt: '2026-07-30T07:11:01.000Z',
              author: 'Al',
            },
          ],
          nextCursor: 11,
          hasMore: false,
        },
      })),
    }

    expect(await pullFieldChanges(transport)).toMatchObject({
      applied: 2,
      cursor: 11,
    })
    expect(await db.readings.get(reading.id)).toMatchObject({
      value: 31.7,
      lorawan: reading.lorawan,
    })
    expect(await db.insights.get(insight.id)).toMatchObject({
      title: 'Inspect irrigation pressure',
      readOnly: true,
    })
    expect(
      (await db.syncMetadata.get(`sensor_reading:${reading.id}`))?.revision,
    ).toBe(1)
    expect(
      (await db.syncMetadata.get(`al_insight:${insight.id}`))?.revision,
    ).toBe(1)
  })

  it('turns a pull collision into a preserved local/server conflict', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'create',
      payload: property,
    })
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [
            {
              cursor: 2,
              entityType: 'property',
              entityId: property.id,
              revision: 1,
              operation: 'create',
              payload: { ...property, name: 'Other Device Farm' },
              serverUpdatedAt: '2026-07-30T07:00:00.000Z',
              author: 'Field Two',
            },
          ],
          nextCursor: 2,
          hasMore: false,
        },
      })),
    }

    const result = await pullFieldChanges(transport)
    expect(result.conflicts).toBe(1)
    expect((await db.properties.get(property.id))?.name).toBe('Test Farm')
    expect((await db.outbox.get(queued.id))?.conflict?.author).toBe('Field Two')
  })

  it('downloads and verifies remote media before advancing its cursor', async () => {
    const mediaId = '29271ccb-27e9-41af-b4a6-4c4385a2200c'
    const checksum = 'a'.repeat(64)
    const localUri =
      'file:///private/app/AetherTAK/FieldMedia/29271ccb-27e9-41af-b4a6-4c4385a2200c.jpg'
    const download = vi.fn(async () => ({
      status: 200,
      body: {
        mediaId,
        localUri,
        sha256: checksum,
        sizeBytes: 2048,
        contentType: 'image/jpeg',
      },
    }))
    const transport = {
      upload: vi.fn(),
      download,
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [
            {
              cursor: 9,
              entityType: 'media',
              entityId: mediaId,
              revision: 1,
              operation: 'create',
              payload: {
                id: mediaId,
                observationId: null,
                kind: 'photo',
                mimeType: 'image/jpeg',
                coordinate: property.center,
                capturedAt: '2026-07-30T07:05:00.000Z',
                deviceModel: 'Field Camera',
                sha256: checksum,
                depthMetadata: null,
                syncState: 'synced',
              },
              serverUpdatedAt: '2026-07-30T07:05:01.000Z',
              author: 'Field Two',
            },
          ],
          nextCursor: 9,
          hasMore: false,
        },
      })),
    }

    expect(await pullFieldChanges(transport)).toMatchObject({
      applied: 1,
      cursor: 9,
    })
    expect(download).toHaveBeenCalledWith({
      mediaId,
      expectedContentType: 'image/jpeg',
      expectedSha256: checksum,
    })
    expect(await db.media.get(mediaId)).toMatchObject({
      localUri,
      previewUri: localUri,
      sha256: checksum,
      syncState: 'synced',
    })
  })

  it('applies remote tombstones without resurrecting deleted records', async () => {
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [
            {
              cursor: 4,
              entityType: 'property',
              entityId: property.id,
              revision: 2,
              operation: 'delete',
              payload: null,
              serverUpdatedAt: '2026-07-30T07:00:00.000Z',
              author: 'Field Two',
            },
          ],
          nextCursor: 4,
          hasMore: false,
        },
      })),
    }

    await pullFieldChanges(transport)
    expect(await db.properties.get(property.id)).toBeUndefined()
    expect(
      (await db.syncMetadata.get(`property:${property.id}`))?.revision,
    ).toBe(2)
  })

  it('applies publisher tombstones to sensor and insight records', async () => {
    const reading = demoSnapshot.readings[0]
    const insight = demoSnapshot.insights[0]
    await db.readings.put(reading)
    await db.insights.put(insight)
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [
            {
              cursor: 12,
              entityType: 'sensor_reading',
              entityId: reading.id,
              revision: 2,
              operation: 'delete',
              payload: null,
              serverUpdatedAt: '2026-07-30T07:12:00.000Z',
              author: 'ChirpStack',
            },
            {
              cursor: 13,
              entityType: 'al_insight',
              entityId: insight.id,
              revision: 2,
              operation: 'delete',
              payload: null,
              serverUpdatedAt: '2026-07-30T07:12:01.000Z',
              author: 'Al',
            },
          ],
          nextCursor: 13,
          hasMore: false,
        },
      })),
    }

    await pullFieldChanges(transport)
    expect(await db.readings.get(reading.id)).toBeUndefined()
    expect(await db.insights.get(insight.id)).toBeUndefined()
  })
})
