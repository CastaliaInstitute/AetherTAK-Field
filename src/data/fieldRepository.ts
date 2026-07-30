import type {
  DashboardSnapshot,
  EcologicalSite,
  Field,
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

type MutableFieldEntity =
  | { type: 'property'; value: Property }
  | { type: 'season'; value: Season }
  | { type: 'field'; value: Field }
  | { type: 'ecological_site'; value: EcologicalSite }
  | { type: 'observation'; value: Observation }

export async function saveLocalEntity(entity: MutableFieldEntity) {
  await db.transaction(
    'rw',
    [
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.observations,
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

export async function loadDashboard(): Promise<
  Omit<DashboardSnapshot, 'contacts'>
> {
  const [
    properties,
    seasons,
    fields,
    ecologicalSites,
    readings,
    observations,
    alerts,
    insights,
  ] = await Promise.all([
    db.properties.toArray(),
    db.seasons.toArray(),
    db.fields.toArray(),
    db.ecologicalSites.toArray(),
    db.readings.orderBy('recordedAt').reverse().toArray(),
    db.observations.orderBy('observedAt').reverse().toArray(),
    db.alerts.orderBy('createdAt').reverse().toArray(),
    db.insights.orderBy('generatedAt').reverse().toArray(),
  ])

  return {
    properties,
    seasons,
    fields,
    ecologicalSites,
    readings,
    observations,
    alerts,
    insights: insights.filter(
      (insight) => new Date(insight.expiresAt).getTime() > Date.now(),
    ),
  }
}
