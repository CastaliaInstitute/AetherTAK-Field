import 'fake-indexeddb/auto'
import Dexie from 'dexie'
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
      mode: 'preview',
    })
  })

  it('keeps a fresh native installation empty', async () => {
    await expect(initializeFieldDatabase(null)).resolves.toBe(false)

    const dashboard = await loadDashboard()
    expect(dashboard.properties).toEqual([])
    expect(dashboard.fields).toEqual([])
    expect(dashboard.readings).toEqual([])
    expect(dashboard.alerts).toEqual([])
    expect(dashboard.insights).toEqual([])
    expect(await db.appMetadata.get('initial-seed')).toMatchObject({
      key: 'initial-seed',
      mode: 'empty',
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

  it('does not add preview records after native initialization', async () => {
    await initializeFieldDatabase(null)

    await expect(initializeFieldDatabase(demoSnapshot)).resolves.toBe(false)
    expect(await db.properties.count()).toBe(0)
    expect(await db.fields.count()).toBe(0)
  })

  it('migrates field and alert sync states from the durable outbox', async () => {
    await db.delete()
    const legacy = new Dexie('aethertak-field')
    legacy.version(6).stores({
      fields: 'id',
      alerts: 'id',
      outbox: 'id, entityType, entityId',
    })
    await legacy.open()
    const { syncState: _firstState, ...firstField } = demoSnapshot.fields[0]
    const { syncState: _secondState, ...secondField } = demoSnapshot.fields[1]
    const { syncState: _alertState, ...alert } = demoSnapshot.alerts[0]
    await legacy.table('fields').bulkAdd([firstField, secondField])
    await legacy.table('alerts').add(alert)
    await legacy.table('outbox').bulkAdd([
      {
        id: 'legacy-conflict',
        entityType: 'field',
        entityId: firstField.id,
        createdAt: '2026-07-30T12:00:00.000Z',
        conflict: { revision: 2 },
      },
      {
        id: 'legacy-queued',
        entityType: 'field',
        entityId: secondField.id,
        createdAt: '2026-07-30T12:00:00.000Z',
        conflict: null,
      },
    ])
    legacy.close()

    await db.open()

    expect((await db.fields.get(firstField.id))?.syncState).toBe('conflict')
    expect((await db.fields.get(secondField.id))?.syncState).toBe('queued')
    expect((await db.alerts.get(alert.id))?.syncState).toBe('synced')
    expect(
      (await db.outbox.orderBy('clientSequence').toArray()).map((item) => [
        item.id,
        item.clientSequence,
      ]),
    ).toEqual([
      ['legacy-conflict', 1],
      ['legacy-queued', 2],
    ])
  })
})
