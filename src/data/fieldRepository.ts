import type {
  DashboardSnapshot,
  Alert,
  EcologicalSite,
  Field,
  MediaCapture,
  OfflineMapRegion,
  Observation,
  Property,
  Season,
} from '../domain/models'
import { db, queueMutation } from './database'

export async function seedDatabase(snapshot: DashboardSnapshot) {
  await db.transaction(
    'rw',
    [
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.readings,
      db.observations,
      db.alerts,
      db.insights,
    ],
    async () => {
      await Promise.all([
        db.properties.bulkPut(snapshot.properties),
        db.seasons.bulkPut(snapshot.seasons),
        db.fields.bulkPut(snapshot.fields),
        db.ecologicalSites.bulkPut(snapshot.ecologicalSites),
        db.readings.bulkPut(snapshot.readings),
        db.observations.bulkPut(snapshot.observations),
        db.alerts.bulkPut(snapshot.alerts),
        db.insights.bulkPut(snapshot.insights),
      ])
    },
  )
}

export async function initializeFieldDatabase(snapshot: DashboardSnapshot) {
  return db.transaction(
    'rw',
    [
      db.appMetadata,
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.readings,
      db.observations,
      db.alerts,
      db.insights,
    ],
    async () => {
      if (await db.appMetadata.get('initial-seed')) return false
      const counts = await Promise.all([
        db.properties.count(),
        db.seasons.count(),
        db.fields.count(),
        db.ecologicalSites.count(),
        db.readings.count(),
        db.observations.count(),
        db.alerts.count(),
        db.insights.count(),
      ])
      const empty = counts.every((count) => count === 0)
      if (empty) {
        await Promise.all([
          db.properties.bulkPut(snapshot.properties),
          db.seasons.bulkPut(snapshot.seasons),
          db.fields.bulkPut(snapshot.fields),
          db.ecologicalSites.bulkPut(snapshot.ecologicalSites),
          db.readings.bulkPut(snapshot.readings),
          db.observations.bulkPut(snapshot.observations),
          db.alerts.bulkPut(snapshot.alerts),
          db.insights.bulkPut(snapshot.insights),
        ])
      }
      await db.appMetadata.put({
        key: 'initial-seed',
        completedAt: new Date().toISOString(),
      })
      return empty
    },
  )
}

type MutableFieldEntity =
  | { type: 'property'; value: Property }
  | { type: 'season'; value: Season }
  | { type: 'field'; value: Field }
  | { type: 'ecological_site'; value: EcologicalSite }
  | { type: 'observation'; value: Observation }
  | { type: 'alert'; value: Alert }

export async function saveLocalEntity(entity: MutableFieldEntity) {
  await db.transaction(
    'rw',
    [
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.observations,
      db.alerts,
      db.outbox,
      db.syncMetadata,
    ],
    async () => {
      switch (entity.type) {
        case 'property':
          await db.properties.put(entity.value)
          break
        case 'season':
          await db.seasons.put(entity.value)
          break
        case 'field':
          await db.fields.put(entity.value)
          break
        case 'ecological_site':
          await db.ecologicalSites.put(entity.value)
          break
        case 'observation':
          await db.observations.put(entity.value)
          break
        case 'alert':
          await db.alerts.put(entity.value)
          break
      }
      await queueMutation({
        entityType: entity.type,
        entityId: entity.value.id,
        operation: 'update',
        payload: entity.value,
      })
    },
  )
}

export type FieldDashboardData = Omit<DashboardSnapshot, 'contacts'> & {
  media: MediaCapture[]
  offlineMapRegions: OfflineMapRegion[]
}

export async function loadDashboard(): Promise<FieldDashboardData> {
  const [
    properties,
    seasons,
    fields,
    ecologicalSites,
    readings,
    observations,
    media,
    alerts,
    insights,
    offlineMapRegions,
  ] = await Promise.all([
    db.properties.toArray(),
    db.seasons.toArray(),
    db.fields.toArray(),
    db.ecologicalSites.toArray(),
    db.readings.orderBy('recordedAt').reverse().toArray(),
    db.observations.orderBy('observedAt').reverse().toArray(),
    db.media.orderBy('capturedAt').reverse().toArray(),
    db.alerts.orderBy('createdAt').reverse().toArray(),
    db.insights.orderBy('generatedAt').reverse().toArray(),
    db.offlineMapRegions.orderBy('updatedAt').reverse().toArray(),
  ])

  return {
    properties,
    seasons,
    fields,
    ecologicalSites,
    readings,
    observations,
    media,
    alerts,
    insights: insights.filter(
      (insight) => new Date(insight.expiresAt).getTime() > Date.now(),
    ),
    offlineMapRegions,
  }
}
