import Dexie, { type EntityTable } from 'dexie'
import type {
  Alert,
  Field,
  MediaCapture,
  Observation,
  SensorReading,
} from '../domain/models'

export interface OutboxItem {
  id: string
  entityType: 'field' | 'observation' | 'media' | 'alert'
  entityId: string
  operation: 'create' | 'update' | 'delete'
  payload: unknown
  createdAt: string
  attempts: number
  lastError: string | null
}

class AetherFieldDatabase extends Dexie {
  fields!: EntityTable<Field, 'id'>
  readings!: EntityTable<SensorReading, 'id'>
  observations!: EntityTable<Observation, 'id'>
  media!: EntityTable<MediaCapture, 'id'>
  alerts!: EntityTable<Alert, 'id'>
  outbox!: EntityTable<OutboxItem, 'id'>

  constructor() {
    super('aethertak-field')
    this.version(1).stores({
      fields: 'id, propertyId, status, updatedAt',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts: 'id, severity, fieldId, deviceId, createdAt, acknowledgedAt',
      outbox: 'id, entityType, entityId, operation, createdAt, attempts',
    })
  }
}

export const db = new AetherFieldDatabase()

export async function queueMutation(
  item: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts' | 'lastError'>,
) {
  const queued: OutboxItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  }
  await db.outbox.add(queued)
  return queued
}

