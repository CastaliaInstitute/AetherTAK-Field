import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queueMutation } from '../data/database'
import type { MediaCapture, Property } from '../domain/models'
import { demoSnapshot } from '../domain/seed'
import type { NativeFieldResponse } from '../platform/tak'
import {
  flushFieldOutbox,
  pullFieldChanges,
  resolveFieldConflict,
} from './fieldSync'

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

const media: MediaCapture = {
  id: '29271ccb-27e9-41af-b4a6-4c4385a2200c',
  observationId: null,
  kind: 'point_cloud',
  localUri: 'file:///private/DepthScans/scan/point-cloud.ply',
  previewUri: 'file:///private/DepthScans/scan/preview.jpg',
  mimeType: 'model/ply',
  coordinate: property.center,
  capturedAt: '2026-07-30T06:10:00.000Z',
  deviceModel: null,
  sha256: 'd'.repeat(64),
  depthMetadata: {
    scanId: '3e3ed46b-290e-455a-a763-c59fab2a4321',
    provider: 'arkit-lidar',
    role: 'point_cloud',
    measurements: [],
  },
  syncState: 'queued',
}

function accepted(itemId: string, revision = 1): NativeFieldResponse {
  return {
    status: 200,
    body: {
      accepted: true,
      mutationId: itemId,
      entityType: 'property',
      entityId: property.id,
      revision,
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
    expect(transport.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.not.objectContaining({ syncState: expect.anything() }),
      }),
    )
  })

  it('rebases later offline edits after an earlier mutation is accepted', async () => {
    const first = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'create',
      payload: property,
    })
    const updated = { ...property, name: 'Latest Offline Farm' }
    const second = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'update',
      payload: updated,
    })
    const mutate = vi
      .fn()
      .mockResolvedValueOnce(accepted(first.id, 1))
      .mockResolvedValueOnce(accepted(second.id, 2))
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate,
      changes: vi.fn(),
    }

    await flushFieldOutbox(1, transport)
    expect(await db.outbox.get(second.id)).toMatchObject({
      operation: 'update',
      baseRevision: 1,
    })
    expect((await db.properties.get(property.id))?.syncState).toBe('queued')

    await flushFieldOutbox(1, transport)
    expect(await db.outbox.count()).toBe(0)
    expect((await db.properties.get(property.id))?.syncState).toBe('synced')
    expect(mutate.mock.calls[1][0]).toMatchObject({
      operation: 'update',
      baseRevision: 1,
    })
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

  it('binds a verified evidence digest into upload and mutation metadata', async () => {
    await db.media.add(media)
    const queued = await queueMutation({
      entityType: 'media',
      entityId: media.id,
      operation: 'create',
      payload: media,
    })
    const upload = vi.fn(async () => ({ status: 201, body: {} }))
    const mutate = vi.fn(async () => ({
      status: 200,
      body: {
        accepted: true,
        mutationId: queued.id,
        entityType: 'media',
        entityId: media.id,
        revision: 1,
        cursor: 1,
        serverUpdatedAt: '2026-07-30T06:45:00.000Z',
        idempotentReplay: false,
      },
    }))
    const transport = {
      upload,
      download: vi.fn(),
      mutate,
      changes: vi.fn(),
    }

    expect(await flushFieldOutbox(100, transport)).toMatchObject({
      sent: 1,
      failed: 0,
    })
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: media.id,
      uri: media.localUri,
      contentType: 'model/ply',
      sha256: media.sha256,
    }))
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        sha256: media.sha256,
      }),
    }))
  })

  it('refuses to upload evidence without precomputed integrity metadata', async () => {
    const unchecked = { ...media, sha256: null }
    await db.media.add(unchecked)
    const queued = await queueMutation({
      entityType: 'media',
      entityId: unchecked.id,
      operation: 'create',
      payload: unchecked,
    })
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(),
    }

    expect(await flushFieldOutbox(100, transport)).toMatchObject({
      sent: 0,
      failed: 1,
      remaining: 1,
    })
    expect(transport.upload).not.toHaveBeenCalled()
    expect(transport.mutate).not.toHaveBeenCalled()
    expect((await db.outbox.get(queued.id))?.lastError).toMatch(
      /integrity must be recorded/,
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

  it('tracks conflict state for crop fields and acknowledged alerts', async () => {
    const field = { ...demoSnapshot.fields[0], syncState: 'queued' as const }
    const alert = {
      ...demoSnapshot.alerts[0],
      acknowledgedAt: '2026-07-30T06:40:00.000Z',
      syncState: 'queued' as const,
    }
    await db.fields.put(field)
    await db.alerts.put(alert)
    await queueMutation({
      entityType: 'field',
      entityId: field.id,
      operation: 'update',
      payload: field,
    })
    await queueMutation({
      entityType: 'alert',
      entityId: alert.id,
      operation: 'update',
      payload: alert,
    })
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(async (mutation: Record<string, unknown>) => ({
        status: 409,
        body: {
          error: {
            current: {
              entityType: mutation.entityType,
              entityId: mutation.entityId,
              revision: 2,
              deleted: false,
              payload: mutation.payload,
              updatedAt: '2026-07-30T06:44:00.000Z',
              author: 'Field Two',
            },
          },
        },
      })),
      changes: vi.fn(),
    }

    expect(await flushFieldOutbox(100, transport)).toMatchObject({
      conflicts: 2,
      remaining: 2,
    })
    expect((await db.fields.get(field.id))?.syncState).toBe('conflict')
    expect((await db.alerts.get(alert.id))?.syncState).toBe('conflict')
  })

  it('requeues the latest device version against the current server revision', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'create',
      payload: property,
    })
    await db.outbox.update(queued.id, {
      conflict: {
        entityType: 'property',
        entityId: property.id,
        revision: 4,
        deleted: false,
        payload: { ...property, name: 'Server Farm' },
        updatedAt: '2026-07-30T06:44:00.000Z',
        author: 'Field Two',
      },
    })

    expect(await resolveFieldConflict(queued.id, 'keep_device')).toEqual({
      resolution: 'keep_device',
      queued: true,
      entityDeleted: false,
    })
    expect(await db.outbox.get(queued.id)).toMatchObject({
      operation: 'update',
      baseRevision: 4,
      conflict: null,
      attempts: 0,
    })
    expect((await db.properties.get(property.id))?.syncState).toBe('queued')
    expect(
      (await db.syncMetadata.get(`property:${property.id}`))?.revision,
    ).toBe(4)
  })

  it('uses the server version and discards every pending local edit', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'create',
      payload: property,
    })
    await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'update',
      payload: { ...property, name: 'Later Local Farm' },
    })
    await db.outbox.update(queued.id, {
      conflict: {
        entityType: 'property',
        entityId: property.id,
        revision: 5,
        deleted: false,
        payload: { ...property, name: 'Authoritative Server Farm' },
        updatedAt: '2026-07-30T06:45:00.000Z',
        author: 'Field Two',
      },
    })

    await resolveFieldConflict(queued.id, 'use_server')

    expect((await db.properties.get(property.id))?.name).toBe(
      'Authoritative Server Farm',
    )
    expect((await db.properties.get(property.id))?.syncState).toBe('synced')
    expect(await db.outbox.where('entityId').equals(property.id).count()).toBe(0)
    expect(
      (await db.syncMetadata.get(`property:${property.id}`))?.revision,
    ).toBe(5)
  })

  it('can resurrect a record after a conflicting server tombstone', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'update',
      payload: property,
    })
    await db.outbox.update(queued.id, {
      conflict: {
        entityType: 'property',
        entityId: property.id,
        revision: 6,
        deleted: true,
        payload: null,
        updatedAt: '2026-07-30T06:46:00.000Z',
        author: 'Field Two',
      },
    })

    await resolveFieldConflict(queued.id, 'keep_device')

    expect(await db.outbox.get(queued.id)).toMatchObject({
      operation: 'create',
      baseRevision: 6,
      conflict: null,
    })
  })

  it('accepts a server tombstone and removes pending local edits', async () => {
    const queued = await queueMutation({
      entityType: 'property',
      entityId: property.id,
      operation: 'update',
      payload: property,
    })
    await db.outbox.update(queued.id, {
      conflict: {
        entityType: 'property',
        entityId: property.id,
        revision: 7,
        deleted: true,
        payload: null,
        updatedAt: '2026-07-30T06:47:00.000Z',
        author: 'Field Two',
      },
    })

    expect(await resolveFieldConflict(queued.id, 'use_server')).toEqual({
      resolution: 'use_server',
      queued: false,
      entityDeleted: true,
    })
    expect(await db.properties.get(property.id)).toBeUndefined()
    expect(await db.outbox.where('entityId').equals(property.id).count()).toBe(0)
    expect(
      (await db.syncMetadata.get(`property:${property.id}`))?.revision,
    ).toBe(7)
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

  it('persists server-authoritative Guardian state for offline rendering', async () => {
    const participant = {
      ...demoSnapshot.guardianParticipants[0],
      state: 'caution' as const,
      zone: 'Creek',
      updatedAt: '2026-07-30T07:12:00.000Z',
    }
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [{
            cursor: 12,
            entityType: 'guardian_participant',
            entityId: participant.id,
            revision: 3,
            operation: 'update',
            payload: participant,
            serverUpdatedAt: '2026-07-30T07:12:01.000Z',
            author: 'Guardian Fusion',
          }],
          nextCursor: 12,
          hasMore: false,
        },
      })),
    }

    expect(await pullFieldChanges(transport)).toMatchObject({
      applied: 1,
      cursor: 12,
    })
    expect(await db.guardianParticipants.get(participant.id)).toMatchObject({
      state: 'caution',
      zone: 'Creek',
      alertState: 'none',
    })
    expect(
      (await db.syncMetadata.get(
        `guardian_participant:${participant.id}`,
      ))?.revision,
    ).toBe(3)
  })

  it('rejects Guardian payloads that leak undeclared biometric fields', async () => {
    const participant = {
      ...demoSnapshot.guardianParticipants[0],
      heartRate: 82,
    }
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [{
            cursor: 13,
            entityType: 'guardian_participant',
            entityId: participant.id,
            revision: 1,
            operation: 'create',
            payload: participant,
            serverUpdatedAt: '2026-07-30T07:13:01.000Z',
            author: 'Guardian Fusion',
          }],
          nextCursor: 13,
          hasMore: false,
        },
      })),
    }

    await expect(pullFieldChanges(transport)).rejects.toThrow()
    expect(await db.guardianParticipants.get(participant.id)).toBeUndefined()
    expect(await db.syncControl.get('field')).toBeUndefined()
  })

  it('persists strict server-managed Guardian zone projections', async () => {
    const zone = {
      ...demoSnapshot.guardianZones[0],
      name: 'Updated property operating area',
      updatedAt: '2026-07-30T07:13:30.000Z',
    }
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [{
            cursor: 14,
            entityType: 'guardian_zone',
            entityId: zone.id,
            revision: 2,
            operation: 'update',
            payload: zone,
            serverUpdatedAt: '2026-07-30T07:13:31.000Z',
            author: 'Guardian Rule Engine',
          }],
          nextCursor: 14,
          hasMore: false,
        },
      })),
    }

    expect(await pullFieldChanges(transport)).toMatchObject({
      applied: 1,
      cursor: 14,
    })
    expect(await db.guardianZones.get(zone.id)).toMatchObject({
      name: 'Updated property operating area',
      level: 'green',
      active: true,
    })
    expect(
      (await db.syncMetadata.get(`guardian_zone:${zone.id}`))?.revision,
    ).toBe(2)
  })

  it('persists strict Guardian alert lifecycle projections', async () => {
    const alert = {
      ...demoSnapshot.guardianAlerts[0],
      status: 'acknowledged' as const,
      acknowledgedAt: '2026-07-30T07:14:00.000Z',
      updatedAt: '2026-07-30T07:14:00.000Z',
    }
    const transport = {
      upload: vi.fn(),
      download: vi.fn(),
      mutate: vi.fn(),
      changes: vi.fn(async () => ({
        status: 200,
        body: {
          changes: [{
            cursor: 14,
            entityType: 'guardian_alert',
            entityId: alert.id,
            revision: 2,
            operation: 'update',
            payload: alert,
            serverUpdatedAt: '2026-07-30T07:14:01.000Z',
            author: 'Guardian Rule Engine',
          }],
          nextCursor: 14,
          hasMore: false,
        },
      })),
    }

    expect(await pullFieldChanges(transport)).toMatchObject({
      applied: 1,
      cursor: 14,
    })
    expect(await db.guardianAlerts.get(alert.id)).toMatchObject({
      status: 'acknowledged',
      acknowledgedAt: '2026-07-30T07:14:00.000Z',
    })
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
