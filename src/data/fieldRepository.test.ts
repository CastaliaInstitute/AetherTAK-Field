import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { demoSnapshot } from '../domain/seed'
import { db } from './database'
import {
  loadDashboard,
  saveLocalEntity,
  seedDatabase,
} from './fieldRepository'

describe('offline field repository', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await seedDatabase(demoSnapshot)
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it('hydrates the full agriculture and ecology dashboard', async () => {
    await db.media.add({
      id: '5a52acec-f6ac-4050-8c0f-c47456485726',
      observationId: null,
      kind: 'photo',
      localUri: 'file:///private/field-photo.jpg',
      previewUri: null,
      mimeType: 'image/jpeg',
      coordinate: demoSnapshot.properties[0].center,
      capturedAt: new Date().toISOString(),
      deviceModel: null,
      sha256: null,
      depthMetadata: null,
      syncState: 'queued',
    })
    const dashboard = await loadDashboard()

    expect(dashboard.properties).toHaveLength(1)
    expect(dashboard.seasons[0].status).toBe('active')
    expect(dashboard.fields.some((field) => field.cropIcon === '🥬')).toBe(true)
    expect(dashboard.ecologicalSites[0].siteType).toBe('riparian')
    expect(dashboard.insights.every((insight) => insight.readOnly)).toBe(true)
    expect(dashboard.media[0].localUri).toBe('file:///private/field-photo.jpg')
  })

  it('atomically saves a local edit and queues synchronization', async () => {
    const property = {
      ...demoSnapshot.properties[0],
      name: 'Aether Farm Updated',
      syncState: 'queued' as const,
      updatedAt: new Date().toISOString(),
    }

    await saveLocalEntity({ type: 'property', value: property })

    expect((await db.properties.get(property.id))?.name).toBe(
      'Aether Farm Updated',
    )
    expect(await db.outbox.where('entityId').equals(property.id).count()).toBe(1)
  })
})
