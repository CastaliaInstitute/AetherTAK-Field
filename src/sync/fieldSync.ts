import { z } from 'zod'
import {
  db,
  type OutboxItem,
  type ServerEntity,
} from '../data/database'
import {
  alInsightSchema,
  alertSchema,
  ecologicalSiteSchema,
  fieldSchema,
  guardianParticipantStateSchema,
  guardianAlertSchema,
  guardianZoneSchema,
  mediaCaptureSchema,
  observationSchema,
  propertySchema,
  sensorReadingSchema,
  seasonSchema,
} from '../domain/models'
import {
  fieldApiTransport,
  type NativeFieldResponse,
} from '../platform/tak'

const acceptedMutationSchema = z.object({
  accepted: z.literal(true),
  mutationId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  revision: z.number().int().positive(),
  cursor: z.number().int().nonnegative(),
  serverUpdatedAt: z.string().datetime(),
  idempotentReplay: z.boolean(),
})

const syncedEntityTypes = [
  'property',
  'season',
  'field',
  'ecological_site',
  'observation',
  'media',
  'alert',
  'sensor_reading',
  'al_insight',
  'guardian_participant',
  'guardian_alert',
  'guardian_zone',
] as const

const serverEntitySchema = z.object({
  entityType: z.enum(syncedEntityTypes),
  entityId: z.string(),
  revision: z.number().int().nonnegative(),
  deleted: z.boolean(),
  payload: z.unknown(),
  updatedAt: z.string().datetime(),
  author: z.string(),
})

export interface FieldSyncTransport {
  mutate(mutation: Record<string, unknown>): Promise<NativeFieldResponse>
  upload(options: {
    mediaId: string
    uri: string
    contentType: string
    observationId?: string
    role?: string
    sha256?: string
  }): Promise<NativeFieldResponse>
  download(options: {
    mediaId: string
    expectedSha256?: string
    expectedContentType?: string
  }): Promise<NativeFieldResponse>
  changes(cursor: number, limit?: number): Promise<NativeFieldResponse>
}

export interface FieldFlushResult {
  sent: number
  conflicts: number
  failed: number
  remaining: number
}

const serverChangeSchema = z.object({
  cursor: z.number().int().positive(),
  entityType: z.enum(syncedEntityTypes),
  entityId: z.string(),
  revision: z.number().int().positive(),
  operation: z.enum(['create', 'update', 'delete']),
  payload: z.unknown(),
  serverUpdatedAt: z.string().datetime(),
  author: z.string(),
})

const changePageSchema = z.object({
  changes: z.array(serverChangeSchema),
  nextCursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})

const downloadedMediaSchema = z.object({
  mediaId: z.string(),
  localUri: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
})

type ServerChange = z.infer<typeof serverChangeSchema>

export interface FieldPullResult {
  applied: number
  conflicts: number
  pages: number
  cursor: number
}

function serverPayload(item: OutboxItem) {
  if (item.entityType === 'media') {
    const media = mediaCaptureSchema.parse(item.payload)
    const {
      localUri: _localUri,
      previewUri: _previewUri,
      syncState: _syncState,
      ...portable
    } = media
    return portable
  }
  if (typeof item.payload === 'object' && item.payload !== null) {
    const { syncState: _syncState, ...portable } = item.payload as Record<
      string,
      unknown
    >
    return portable
  }
  return item.payload
}

async function uploadMedia(
  item: OutboxItem,
  transport: FieldSyncTransport,
) {
  if (item.entityType !== 'media' || item.operation === 'delete') return
  const media = mediaCaptureSchema.parse(item.payload)
  if (!media.sha256) {
    throw new Error(
      'Media integrity must be recorded before an evidence artifact can synchronize.',
    )
  }
  const response = await transport.upload({
    mediaId: media.id,
    uri: media.localUri,
    contentType: media.mimeType,
    ...(media.observationId ? { observationId: media.observationId } : {}),
    ...(media.depthMetadata?.role ? { role: media.depthMetadata.role } : {}),
    sha256: media.sha256,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new FieldSyncHttpError(response)
  }
}

class FieldSyncHttpError extends Error {
  readonly response: NativeFieldResponse

  constructor(response: NativeFieldResponse) {
    super(
      typeof response.body.error === 'object' &&
        response.body.error !== null &&
        'message' in response.body.error
        ? String(response.body.error.message)
        : `Aether Field API returned HTTP ${response.status}.`,
    )
    this.response = response
  }
}

function retryAt(attempts: number, now: Date, permanent = false) {
  const seconds = permanent
    ? 24 * 60 * 60
    : Math.min(60 * 60, 5 * 2 ** Math.min(attempts, 10))
  return new Date(now.getTime() + seconds * 1000).toISOString()
}

async function markEntityState(
  item: OutboxItem,
  state: 'queued' | 'synced' | 'conflict',
) {
  switch (item.entityType) {
    case 'property':
      await db.properties.update(item.entityId, { syncState: state })
      break
    case 'season':
      await db.seasons.update(item.entityId, { syncState: state })
      break
    case 'field':
      await db.fields.update(item.entityId, { syncState: state })
      break
    case 'ecological_site':
      await db.ecologicalSites.update(item.entityId, { syncState: state })
      break
    case 'observation':
      await db.observations.update(item.entityId, { syncState: state })
      break
    case 'media':
      await db.media.update(item.entityId, { syncState: state })
      break
    case 'alert':
      await db.alerts.update(item.entityId, { syncState: state })
      break
    default:
      break
  }
}

async function acceptMutation(
  item: OutboxItem,
  response: z.infer<typeof acceptedMutationSchema>,
) {
  if (
    response.mutationId !== item.id ||
    response.entityType !== item.entityType ||
    response.entityId !== item.entityId
  ) {
    throw new Error('Aether Field API accepted a different mutation.')
  }
  await db.transaction(
    'rw',
    [
      db.outbox,
      db.syncMetadata,
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.observations,
      db.media,
      db.alerts,
    ],
    async () => {
      await db.syncMetadata.put({
        key: `${item.entityType}:${item.entityId}`,
        entityType: item.entityType,
        entityId: item.entityId,
        revision: response.revision,
        serverUpdatedAt: response.serverUpdatedAt,
      })
      await db.outbox.delete(item.id)
      const remaining = (await db.outbox.where('entityId').equals(item.entityId).toArray())
        .filter(
          (candidate) => candidate.entityType === item.entityType,
        )
      const later = remaining.filter((candidate) => !candidate.conflict)
      for (const candidate of later) {
        await db.outbox.update(candidate.id, {
          baseRevision: response.revision,
          operation:
            item.operation === 'delete'
              ? candidate.operation === 'delete'
                ? 'delete'
                : 'create'
              : candidate.operation === 'delete'
                ? 'delete'
                : 'update',
        })
      }
      await markEntityState(
        item,
        remaining.some((candidate) => candidate.conflict)
          ? 'conflict'
          : later.length > 0
            ? 'queued'
            : 'synced',
      )
    },
  )
}

async function markConflict(item: OutboxItem, current: ServerEntity) {
  await db.transaction(
    'rw',
    [
      db.outbox,
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.observations,
      db.media,
      db.alerts,
    ],
    async () => {
      await db.outbox.update(item.id, {
        attempts: item.attempts + 1,
        lastError: 'The server record changed; manual conflict resolution is required.',
        conflict: current,
        nextAttemptAt: new Date(8640000000000000).toISOString(),
      })
      await markEntityState(item, 'conflict')
    },
  )
}

function serverEntity(change: ServerChange): ServerEntity {
  return {
    entityType: change.entityType,
    entityId: change.entityId,
    revision: change.revision,
    deleted: change.operation === 'delete',
    payload: change.payload,
    updatedAt: change.serverUpdatedAt,
    author: change.author,
  }
}

async function deleteRemoteEntity(change: ServerChange) {
  switch (change.entityType) {
    case 'property':
      await db.properties.delete(change.entityId)
      break
    case 'season':
      await db.seasons.delete(change.entityId)
      break
    case 'field':
      await db.fields.delete(change.entityId)
      break
    case 'ecological_site':
      await db.ecologicalSites.delete(change.entityId)
      break
    case 'observation':
      await db.observations.delete(change.entityId)
      break
    case 'media':
      await db.media.delete(change.entityId)
      break
    case 'alert':
      await db.alerts.delete(change.entityId)
      break
    case 'sensor_reading':
      await db.readings.delete(change.entityId)
      break
    case 'al_insight':
      await db.insights.delete(change.entityId)
      break
    case 'guardian_participant':
      await db.guardianParticipants.delete(change.entityId)
      break
    case 'guardian_alert':
      await db.guardianAlerts.delete(change.entityId)
      break
    case 'guardian_zone':
      await db.guardianZones.delete(change.entityId)
      break
  }
}

async function downloadRemoteMedia(
  change: ServerChange,
  transport: FieldSyncTransport,
) {
  const descriptor = mediaCaptureSchema.parse({
    ...(typeof change.payload === 'object' && change.payload !== null
      ? change.payload
      : {}),
    localUri: 'aether-field://pending',
    previewUri: null,
    syncState: 'synced',
  })
  const response = await transport.download({
    mediaId: change.entityId,
    expectedContentType: descriptor.mimeType,
    ...(descriptor.sha256
      ? { expectedSha256: descriptor.sha256 }
      : {}),
  })
  if (response.status < 200 || response.status >= 300) {
    throw new FieldSyncHttpError(response)
  }
  const downloaded = downloadedMediaSchema.parse(response.body)
  if (downloaded.mediaId !== change.entityId) {
    throw new Error('Aether Field API returned the wrong media artifact.')
  }
  return downloaded
}

async function putRemoteEntity(
  change: ServerChange,
  downloadedMedia: z.infer<typeof downloadedMediaSchema> | null,
) {
  const payload =
    typeof change.payload === 'object' && change.payload !== null
      ? change.payload
      : {}
  switch (change.entityType) {
    case 'property':
      await db.properties.put(
        propertySchema.parse({ ...payload, syncState: 'synced' }),
      )
      break
    case 'season':
      await db.seasons.put(
        seasonSchema.parse({ ...payload, syncState: 'synced' }),
      )
      break
    case 'field':
      await db.fields.put(
        fieldSchema.parse({ ...payload, syncState: 'synced' }),
      )
      break
    case 'ecological_site':
      await db.ecologicalSites.put(
        ecologicalSiteSchema.parse({ ...payload, syncState: 'synced' }),
      )
      break
    case 'observation':
      await db.observations.put(
        observationSchema.parse({ ...payload, syncState: 'synced' }),
      )
      break
    case 'media':
      if (!downloadedMedia) {
        throw new Error('Remote media was not downloaded before hydration.')
      }
      await db.media.put(
        mediaCaptureSchema.parse({
          ...payload,
          localUri: downloadedMedia.localUri,
          previewUri:
            payload && 'kind' in payload && payload.kind === 'photo'
              ? downloadedMedia.localUri
              : null,
          sha256: downloadedMedia.sha256,
          syncState: 'synced',
        }),
      )
      break
    case 'alert':
      await db.alerts.put(
        alertSchema.parse({ ...payload, syncState: 'synced' }),
      )
      break
    case 'sensor_reading':
      await db.readings.put(sensorReadingSchema.parse(payload))
      break
    case 'al_insight':
      await db.insights.put(alInsightSchema.parse(payload))
      break
    case 'guardian_participant':
      await db.guardianParticipants.put(
        guardianParticipantStateSchema.parse(payload),
      )
      break
    case 'guardian_alert':
      await db.guardianAlerts.put(guardianAlertSchema.parse(payload))
      break
    case 'guardian_zone':
      await db.guardianZones.put(guardianZoneSchema.parse(payload))
      break
  }
}

async function applyRemoteChange(
  change: ServerChange,
  transport: FieldSyncTransport,
) {
  const metadataKey = `${change.entityType}:${change.entityId}`
  const [metadata, pending] = await Promise.all([
    db.syncMetadata.get(metadataKey),
    db.outbox.where('entityId').equals(change.entityId).toArray(),
  ])
  if (metadata && metadata.revision >= change.revision) return 'ignored' as const

  const colliding = pending.find(
    (item) => item.entityType === change.entityType && !item.conflict,
  )
  if (colliding) {
    await markConflict(colliding, serverEntity(change))
    return 'conflict' as const
  }

  const downloadedMedia =
    change.entityType === 'media' && change.operation !== 'delete'
      ? await downloadRemoteMedia(change, transport)
      : null

  await db.transaction(
    'rw',
    [
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.observations,
      db.media,
      db.alerts,
      db.readings,
      db.insights,
      db.guardianParticipants,
      db.guardianAlerts,
      db.guardianZones,
      db.syncMetadata,
    ],
    async () => {
      if (change.operation === 'delete') {
        await deleteRemoteEntity(change)
      } else {
        await putRemoteEntity(change, downloadedMedia)
      }
      await db.syncMetadata.put({
        key: metadataKey,
        entityType: change.entityType,
        entityId: change.entityId,
        revision: change.revision,
        serverUpdatedAt: change.serverUpdatedAt,
      })
    },
  )
  return 'applied' as const
}

export type FieldConflictResolution = 'keep_device' | 'use_server'

export async function resolveFieldConflict(
  outboxId: string,
  resolution: FieldConflictResolution,
  transport: FieldSyncTransport = fieldApiTransport,
) {
  const item = await db.outbox.get(outboxId)
  if (!item?.conflict) {
    throw new Error('This synchronization conflict no longer exists.')
  }
  const current = item.conflict
  if (
    current.entityType !== item.entityType ||
    current.entityId !== item.entityId
  ) {
    throw new Error('The synchronization conflict refers to the wrong record.')
  }
  const matching = (await db.outbox.where('entityId').equals(item.entityId).toArray())
    .filter((candidate) => candidate.entityType === item.entityType)
    .sort((left, right) => left.clientSequence - right.clientSequence)

  if (
    resolution === 'keep_device' &&
    !(current.deleted && matching.at(-1)?.operation === 'delete')
  ) {
    const desired = matching.at(-1) ?? item
    const operation: OutboxItem['operation'] = current.deleted
      ? 'create'
      : desired.operation === 'delete'
        ? 'delete'
        : 'update'
    const now = new Date().toISOString()
    await db.transaction(
      'rw',
      [
        db.outbox,
        db.syncMetadata,
        db.properties,
        db.seasons,
        db.fields,
        db.ecologicalSites,
        db.observations,
        db.media,
        db.alerts,
      ],
      async () => {
        await db.outbox.bulkDelete(
          matching
            .filter((candidate) => candidate.id !== item.id)
            .map((candidate) => candidate.id),
        )
        await db.outbox.update(item.id, {
          operation,
          payload: desired.payload,
          attempts: 0,
          lastError: null,
          baseRevision: current.revision,
          nextAttemptAt: now,
          conflict: null,
        })
        await db.syncMetadata.put({
          key: `${item.entityType}:${item.entityId}`,
          entityType: item.entityType,
          entityId: item.entityId,
          revision: current.revision,
          serverUpdatedAt: current.updatedAt,
        })
        await markEntityState(item, 'queued')
      },
    )
    return { resolution, queued: true, entityDeleted: false }
  }

  const change: ServerChange = {
    cursor: 1,
    entityType: current.entityType,
    entityId: current.entityId,
    revision: current.revision,
    operation: current.deleted ? 'delete' : 'update',
    payload: current.payload,
    serverUpdatedAt: current.updatedAt,
    author: current.author,
  }
  const downloadedMedia =
    change.entityType === 'media' && !current.deleted
      ? await downloadRemoteMedia(change, transport)
      : null
  await db.transaction(
    'rw',
    [
      db.outbox,
      db.syncMetadata,
      db.properties,
      db.seasons,
      db.fields,
      db.ecologicalSites,
      db.observations,
      db.media,
      db.alerts,
      db.readings,
      db.insights,
      db.guardianParticipants,
      db.guardianAlerts,
      db.guardianZones,
    ],
    async () => {
      if (current.deleted) {
        await deleteRemoteEntity(change)
      } else {
        await putRemoteEntity(change, downloadedMedia)
      }
      await db.syncMetadata.put({
        key: `${item.entityType}:${item.entityId}`,
        entityType: item.entityType,
        entityId: item.entityId,
        revision: current.revision,
        serverUpdatedAt: current.updatedAt,
      })
      await db.outbox.bulkDelete(matching.map((candidate) => candidate.id))
    },
  )
  return {
    resolution: 'use_server' as const,
    queued: false,
    entityDeleted: current.deleted,
  }
}

async function markFailure(
  item: OutboxItem,
  error: unknown,
  now: Date,
  permanent: boolean,
) {
  const attempts = item.attempts + 1
  await db.outbox.update(item.id, {
    attempts,
    lastError: error instanceof Error ? error.message : 'Unknown synchronization error.',
    nextAttemptAt: retryAt(attempts, now, permanent),
  })
}

export async function flushFieldOutbox(
  limit = 100,
  transport: FieldSyncTransport = fieldApiTransport,
  now = new Date(),
): Promise<FieldFlushResult> {
  const pending = (await db.outbox.orderBy('clientSequence').toArray())
    .filter(
      (item) =>
        !item.conflict &&
        (!item.nextAttemptAt ||
          new Date(item.nextAttemptAt).getTime() <= now.getTime()),
    )
    .slice(0, limit)
  let sent = 0
  let conflicts = 0
  let failed = 0

  for (const item of pending) {
    try {
      await uploadMedia(item, transport)
      const nativeResponse = await transport.mutate({
        id: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
        operation: item.operation,
        baseRevision: item.baseRevision,
        payload: serverPayload(item),
      })
      if (nativeResponse.status === 409) {
        const error = z
          .object({
            error: z.object({
              current: serverEntitySchema.nullable(),
            }),
          })
          .parse(nativeResponse.body)
        if (error.error.current) {
          await markConflict(item, error.error.current)
          conflicts += 1
          continue
        }
        throw new FieldSyncHttpError(nativeResponse)
      }
      if (nativeResponse.status < 200 || nativeResponse.status >= 300) {
        throw new FieldSyncHttpError(nativeResponse)
      }
      await acceptMutation(
        item,
        acceptedMutationSchema.parse(nativeResponse.body),
      )
      sent += 1
    } catch (error) {
      const status =
        error instanceof FieldSyncHttpError ? error.response.status : 0
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429
      await markFailure(item, error, now, permanent)
      failed += 1
      if (!permanent) break
    }
  }

  return {
    sent,
    conflicts,
    failed,
    remaining: await db.outbox.count(),
  }
}

export async function pullFieldChanges(
  transport: FieldSyncTransport = fieldApiTransport,
  pageSize = 100,
  maxPages = 20,
): Promise<FieldPullResult> {
  const control = await db.syncControl.get('field')
  let cursor = control?.cursor ?? 0
  let applied = 0
  let conflicts = 0
  let pages = 0

  while (pages < maxPages) {
    const response = await transport.changes(cursor, pageSize)
    if (response.status < 200 || response.status >= 300) {
      throw new FieldSyncHttpError(response)
    }
    const page = changePageSchema.parse(response.body)
    if (page.nextCursor < cursor) {
      throw new Error('Aether Field API change cursor moved backwards.')
    }
    for (const change of page.changes) {
      const outcome = await applyRemoteChange(change, transport)
      if (outcome === 'applied') applied += 1
      if (outcome === 'conflict') conflicts += 1
    }
    cursor = page.nextCursor
    pages += 1
    await db.syncControl.put({
      id: 'field',
      cursor,
      lastSyncAt: new Date().toISOString(),
    })
    if (!page.hasMore) break
  }

  return { applied, conflicts, pages, cursor }
}

export async function synchronizeFieldData(
  transport: FieldSyncTransport = fieldApiTransport,
) {
  const pushed = await flushFieldOutbox(100, transport)
  const pulled = await pullFieldChanges(transport)
  return { pushed, pulled }
}
