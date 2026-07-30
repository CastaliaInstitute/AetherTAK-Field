import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { demoSnapshot } from '../domain/seed'
import { db } from './database'
import {
  initializeFieldDatabase,
  loadDashboard,
} from './fieldRepository'

describe('field database initialization', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it('seeds an empty installation and records completion', async () => {
    await expect(initializeFieldDatabase(demoSnapshot)).resolves.toBe(true)

    expect((await loadDashboard()).fields).toEqual(demoSnapshot.fields)
    expect(await db.appMetadata.get('initial-seed')).toMatchObject({
      key: 'initial-seed',
    })
  })

  it('preserves existing records instead of adding demo data', async () => {
    const existing = {
      ...demoSnapshot.properties[0],
      id: 'existing-property',
      name: 'Existing Farm',
    }
    await db.properties.put(existing)

    await expect(initializeFieldDatabase(demoSnapshot)).resolves.toBe(false)

    expect(await db.properties.toArray()).toEqual([existing])
    expect(await db.fields.count()).toBe(0)
    expect(await db.appMetadata.get('initial-seed')).toBeDefined()
  })

  it('does not resurrect seed data after an initialized database is cleared', async () => {
    await initializeFieldDatabase(demoSnapshot)
    await db.fields.clear()

    await expect(initializeFieldDatabase(demoSnapshot)).resolves.toBe(false)
    expect(await db.fields.count()).toBe(0)
  })
})
