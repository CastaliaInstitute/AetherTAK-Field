import Dexie, { type EntityTable } from 'dexie'
import type {
  Alert,
  AlInsight,
  EcologicalSite,
  Field,
  MediaCapture,
  Observation,
  OfflineMapRegion,
  Property,
  Season,
  SensorReading,
} from '../domain/models'
import type { QueuedTakEvent } from '../tak/outbox'

export interface OutboxItem {
  id: string
  entityType:
    | 'property'
    | 'season'
    | 'field'
    | 'ecological_site'
    | 'observation'
    | 'media'
    | 'alert'
  entityId: string
  operation: 'create' | 'update' | 'delete'
  payload: unknown
  createdAt: string
  attempts: number
  lastError: string | null
}

class AetherFieldDatabase extends Dexie {
  properties!: EntityTable<Property, 'id'>
  seasons!: EntityTable<Season, 'id'>
  fields!: EntityTable<Field, 'id'>
  ecologicalSites!: EntityTable<EcologicalSite, 'id'>
  readings!: EntityTable<SensorReading, 'id'>
  observations!: EntityTable<Observation, 'id'>
  media!: EntityTable<MediaCapture, 'id'>
  alerts!: EntityTable<Alert, 'id'>
  insights!: EntityTable<AlInsight, 'id'>
  offlineMapRegions!: EntityTable<OfflineMapRegion, 'id'>
  outbox!: EntityTable<OutboxItem, 'id'>
  takOutbox!: EntityTable<QueuedTakEvent, 'id'>

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
    this.version(2).stores({
      fields: 'id, propertyId, status, updatedAt',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts: 'id, severity, fieldId, deviceId, createdAt, acknowledgedAt',
      outbox: 'id, entityType, entityId, operation, createdAt, attempts',
      takOutbox: 'id, createdAt, attempts, operation.kind',
    })
    this.version(3).stores({
      properties: 'id, name, updatedAt, syncState',
      seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
      fields: 'id, propertyId, seasonId, status, updatedAt',
      ecologicalSites:
        'id, propertyId, siteType, updatedAt, syncState',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts: 'id, severity, fieldId, deviceId, createdAt, acknowledgedAt',
      insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
      offlineMapRegions: 'id, tileSourceId, status, updatedAt',
      outbox: 'id, entityType, entityId, operation, createdAt, attempts',
      takOutbox: 'id, createdAt, attempts, operation.kind',
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
