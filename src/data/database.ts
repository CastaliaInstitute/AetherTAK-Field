import Dexie, { type EntityTable } from 'dexie'
import type {
  Alert,
  AlInsight,
  EcologicalSite,
  Field,
  GuardianParticipantState,
  GuardianAlert,
  MediaCapture,
  Observation,
  OfflineMapRegion,
  Property,
  Season,
  SensorReading,
} from '../domain/models'
import type { QueuedTakEvent } from '../tak/outbox'
import type { TakActivity } from '../tak/activity'

export interface OutboxItem {
  id: string
  entityType: MutableEntityType
  entityId: string
  operation: 'create' | 'update' | 'delete'
  payload: unknown
  createdAt: string
  clientSequence: number
  attempts: number
  lastError: string | null
  baseRevision: number | null
  nextAttemptAt: string
  conflict: ServerEntity | null
}

export type MutableEntityType =
  | 'property'
  | 'season'
  | 'field'
  | 'ecological_site'
  | 'observation'
  | 'media'
  | 'alert'

export type SyncedEntityType =
  | MutableEntityType
  | 'sensor_reading'
  | 'al_insight'
  | 'guardian_participant'
  | 'guardian_alert'

export interface ServerEntity {
  entityType: SyncedEntityType
  entityId: string
  revision: number
  deleted: boolean
  payload: unknown
  updatedAt: string
  author: string
}

export interface SyncMetadata {
  key: string
  entityType: SyncedEntityType
  entityId: string
  revision: number
  serverUpdatedAt: string
}

export interface SyncControl {
  id: 'field'
  cursor: number
  lastSyncAt: string | null
}

export interface AppMetadata {
  key: 'initial-seed'
  completedAt: string
  mode?: 'preview' | 'empty'
}

export interface GuardianActionOutbox {
  id: string
  kind: 'check_in' | 'acknowledge' | 'resolve'
  targetId: string
  reason: string | null
  createdAt: string
  attempts: number
  lastError: string | null
  nextAttemptAt: string
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
  guardianParticipants!: EntityTable<GuardianParticipantState, 'id'>
  guardianAlerts!: EntityTable<GuardianAlert, 'id'>
  guardianActions!: EntityTable<GuardianActionOutbox, 'id'>
  offlineMapRegions!: EntityTable<OfflineMapRegion, 'id'>
  outbox!: EntityTable<OutboxItem, 'id'>
  takOutbox!: EntityTable<QueuedTakEvent, 'id'>
  takActivity!: EntityTable<TakActivity, 'id'>
  syncMetadata!: EntityTable<SyncMetadata, 'key'>
  syncControl!: EntityTable<SyncControl, 'id'>
  appMetadata!: EntityTable<AppMetadata, 'key'>

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
    this.version(4).stores({
      properties: 'id, name, updatedAt, syncState',
      seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
      fields: 'id, propertyId, seasonId, status, updatedAt',
      ecologicalSites: 'id, propertyId, siteType, updatedAt, syncState',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts: 'id, severity, fieldId, deviceId, createdAt, acknowledgedAt',
      insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
      offlineMapRegions: 'id, tileSourceId, status, updatedAt',
      outbox:
        'id, entityType, entityId, operation, createdAt, attempts, nextAttemptAt',
      takOutbox: 'id, createdAt, attempts, operation.kind',
      syncMetadata: 'key, entityType, entityId, revision',
      syncControl: 'id',
    })
    this.version(5).stores({
      properties: 'id, name, updatedAt, syncState',
      seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
      fields: 'id, propertyId, seasonId, status, updatedAt',
      ecologicalSites: 'id, propertyId, siteType, updatedAt, syncState',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts: 'id, severity, fieldId, deviceId, createdAt, acknowledgedAt',
      insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
      offlineMapRegions: 'id, tileSourceId, status, updatedAt',
      outbox:
        'id, entityType, entityId, operation, createdAt, attempts, nextAttemptAt',
      takOutbox: 'id, createdAt, attempts, operation.kind',
      takActivity:
        'id, uid, direction, kind, createdAt, deliveryStatus, outboxId',
      syncMetadata: 'key, entityType, entityId, revision',
      syncControl: 'id',
    })
    this.version(6).stores({
      properties: 'id, name, updatedAt, syncState',
      seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
      fields: 'id, propertyId, seasonId, status, updatedAt',
      ecologicalSites: 'id, propertyId, siteType, updatedAt, syncState',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts: 'id, severity, fieldId, deviceId, createdAt, acknowledgedAt',
      insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
      offlineMapRegions: 'id, tileSourceId, status, updatedAt',
      outbox:
        'id, entityType, entityId, operation, createdAt, attempts, nextAttemptAt',
      takOutbox: 'id, createdAt, attempts, operation.kind',
      takActivity:
        'id, uid, direction, kind, createdAt, deliveryStatus, outboxId',
      syncMetadata: 'key, entityType, entityId, revision',
      syncControl: 'id',
      appMetadata: 'key',
    })
    this.version(7)
      .stores({
        properties: 'id, name, updatedAt, syncState',
        seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
        fields: 'id, propertyId, seasonId, status, updatedAt, syncState',
        ecologicalSites: 'id, propertyId, siteType, updatedAt, syncState',
        readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
        observations: 'id, fieldId, siteId, category, observedAt, syncState',
        media: 'id, observationId, kind, capturedAt, syncState',
        alerts:
          'id, severity, fieldId, deviceId, createdAt, acknowledgedAt, syncState',
        insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
        offlineMapRegions: 'id, tileSourceId, status, updatedAt',
        outbox:
          'id, entityType, entityId, operation, createdAt, attempts, nextAttemptAt',
        takOutbox: 'id, createdAt, attempts, operation.kind',
        takActivity:
          'id, uid, direction, kind, createdAt, deliveryStatus, outboxId',
        syncMetadata: 'key, entityType, entityId, revision',
        syncControl: 'id',
        appMetadata: 'key',
      })
      .upgrade(async (transaction) => {
        const pending = (await transaction.table('outbox').toArray()) as OutboxItem[]
        const stateFor = (entityType: MutableEntityType, entityId: string) => {
          const matching = pending.filter(
            (item) =>
              item.entityType === entityType && item.entityId === entityId,
          )
          return matching.some((item) => item.conflict)
            ? 'conflict'
            : matching.length > 0
              ? 'queued'
              : 'synced'
        }
        await transaction
          .table('fields')
          .toCollection()
          .modify((record) => {
            record.syncState = stateFor('field', record.id)
          })
        await transaction
          .table('alerts')
          .toCollection()
          .modify((record) => {
            record.syncState = stateFor('alert', record.id)
          })
      })
    this.version(8)
      .stores({
        properties: 'id, name, updatedAt, syncState',
        seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
        fields: 'id, propertyId, seasonId, status, updatedAt, syncState',
        ecologicalSites: 'id, propertyId, siteType, updatedAt, syncState',
        readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
        observations: 'id, fieldId, siteId, category, observedAt, syncState',
        media: 'id, observationId, kind, capturedAt, syncState',
        alerts:
          'id, severity, fieldId, deviceId, createdAt, acknowledgedAt, syncState',
        insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
        offlineMapRegions: 'id, tileSourceId, status, updatedAt',
        outbox:
          'id, entityType, entityId, operation, createdAt, clientSequence, attempts, nextAttemptAt',
        takOutbox: 'id, createdAt, attempts, operation.kind',
        takActivity:
          'id, uid, direction, kind, createdAt, deliveryStatus, outboxId',
        syncMetadata: 'key, entityType, entityId, revision',
        syncControl: 'id',
        appMetadata: 'key',
      })
      .upgrade(async (transaction) => {
        const outbox = transaction.table('outbox')
        const queued = (await outbox.toArray()).sort(
          (left, right) =>
            String(left.createdAt).localeCompare(String(right.createdAt)) ||
            String(left.id).localeCompare(String(right.id)),
        )
        for (const [index, item] of queued.entries()) {
          await outbox.update(item.id, { clientSequence: index + 1 })
        }
      })
    this.version(9).stores({
      properties: 'id, name, updatedAt, syncState',
      seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
      fields: 'id, propertyId, seasonId, status, updatedAt, syncState',
      ecologicalSites: 'id, propertyId, siteType, updatedAt, syncState',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts:
        'id, severity, fieldId, deviceId, createdAt, acknowledgedAt, syncState',
      insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
      guardianParticipants:
        'id, state, alertState, checkIn, location.observedAt, device.lastContactAt, updatedAt',
      offlineMapRegions: 'id, tileSourceId, status, updatedAt',
      outbox:
        'id, entityType, entityId, operation, createdAt, clientSequence, attempts, nextAttemptAt',
      takOutbox: 'id, createdAt, attempts, operation.kind',
      takActivity:
        'id, uid, direction, kind, createdAt, deliveryStatus, outboxId',
      syncMetadata: 'key, entityType, entityId, revision',
      syncControl: 'id',
      appMetadata: 'key',
    })
    this.version(10).stores({
      properties: 'id, name, updatedAt, syncState',
      seasons: 'id, propertyId, status, startsOn, endsOn, updatedAt, syncState',
      fields: 'id, propertyId, seasonId, status, updatedAt, syncState',
      ecologicalSites: 'id, propertyId, siteType, updatedAt, syncState',
      readings: 'id, deviceId, fieldId, siteId, measurement, recordedAt',
      observations: 'id, fieldId, siteId, category, observedAt, syncState',
      media: 'id, observationId, kind, capturedAt, syncState',
      alerts:
        'id, severity, fieldId, deviceId, createdAt, acknowledgedAt, syncState',
      insights: 'id, fieldId, siteId, severity, generatedAt, expiresAt',
      guardianParticipants:
        'id, state, alertState, checkIn, location.observedAt, device.lastContactAt, updatedAt',
      guardianAlerts:
        'id, participantId, severity, status, openedAt, updatedAt',
      guardianActions:
        'id, kind, targetId, createdAt, attempts, nextAttemptAt',
      offlineMapRegions: 'id, tileSourceId, status, updatedAt',
      outbox:
        'id, entityType, entityId, operation, createdAt, clientSequence, attempts, nextAttemptAt',
      takOutbox: 'id, createdAt, attempts, operation.kind',
      takActivity:
        'id, uid, direction, kind, createdAt, deliveryStatus, outboxId',
      syncMetadata: 'key, entityType, entityId, revision',
      syncControl: 'id',
      appMetadata: 'key',
    })
  }
}

export const db = new AetherFieldDatabase()

export async function queueMutation(
  item: Omit<
    OutboxItem,
    | 'id'
    | 'createdAt'
    | 'clientSequence'
    | 'attempts'
    | 'lastError'
    | 'baseRevision'
    | 'nextAttemptAt'
    | 'conflict'
  >,
) {
  return db.transaction(
    'rw',
    [db.outbox, db.syncMetadata],
    async () => {
      const metadata = await db.syncMetadata.get(
        `${item.entityType}:${item.entityId}`,
      )
      const operation =
        item.operation === 'update' && !metadata ? 'create' : item.operation
      const highestSequence = (await db.outbox.orderBy('clientSequence').last())
        ?.clientSequence ?? 0
      const now = new Date().toISOString()
      const queued: OutboxItem = {
        ...item,
        operation,
        id: crypto.randomUUID(),
        createdAt: now,
        clientSequence: highestSequence + 1,
        attempts: 0,
        lastError: null,
        baseRevision: metadata?.revision ?? null,
        nextAttemptAt: now,
        conflict: null,
      }
      await db.outbox.add(queued)
      return queued
    },
  )
}
