import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queueMutation } from '../data/database'
import type { Property } from '../domain/models'
import type { NativeFieldResponse } from '../platform/tak'
import { flushFieldOutbox } from './fieldSync'

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
      mutate: vi.fn(async () => accepted(queued.id)),
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
      mutate: vi.fn(async () => {
        throw new Error('offline')
      }),
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
    }

    const result = await flushFieldOutbox(100, transport)
    expect(result.conflicts).toBe(1)
    expect((await db.outbox.get(queued.id))?.conflict?.revision).toBe(2)
    expect((await db.properties.get(property.id))?.syncState).toBe('conflict')
  })
})
