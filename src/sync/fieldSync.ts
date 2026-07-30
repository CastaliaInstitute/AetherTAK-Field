import { z } from 'zod'
import {
  db,
  type OutboxItem,
  type ServerEntity,
} from '../data/database'
import {
  alertSchema,
  ecologicalSiteSchema,
  fieldSchema,
  mediaCaptureSchema,
  observationSchema,
  propertySchema,
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

const serverEntitySchema = z.object({
  entityType: z.enum([
    'property',
    'season',
    'field',
    'ecological_site',
    'observation',
    'media',
    'alert',
  ]),
  entityId: z.string(),
  revision: z.number().int().nonnegative(),
  deleted: z.boolean(),
  payload: z.unknown(),
  updatedAt: z.string().datetime(),
  author: z.string(),
})

interface FieldSyncTransport {
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
  entityType: z.enum([
    'property',
    'season',
    'field',
    'ecological_site',
    'observation',
    'media',
    'alert',
  ]),
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
  if (item.entityType !== 'media') return item.payload
  const media = mediaCaptureSchema.parse(item.payload)
  const { localUri: _localUri, previewUri: _previewUri, ...portable } = media
  return portable
}

async function uploadMedia(
  item: OutboxItem,
  transport: FieldSyncTransport,
) {
  if (item.entityType !== 'media' || item.operation === 'delete') return
  const media = mediaCaptureSchema.parse(item.payload)
  const response = await transport.upload({
    mediaId: media.id,
    uri: media.localUri,
    contentType: media.mimeType,
    ...(media.observationId ? { observationId: media.observationId } : {}),
    ...(media.depthMetadata?.role ? { role: media.depthMetadata.role } : {}),
    ...(media.sha256 ? { sha256: media.sha256 } : {}),
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
  state: 'synced' | 'conflict',
) {
  switch (item.entityType) {
    case 'property':
      await db.properties.update(item.entityId, { syncState: state })
      break
    case 'season':
      await db.seasons.update(item.entityId, { syncState: state })
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
    default:
      break
  }
}

async function acceptMutation(
  item: OutboxItem,
  response: z.infer<typeof acceptedMutationSchema>,
) {
  await db.transaction(
    'rw',
    [
      db.outbox,
      db.syncMetadata,
      db.properties,
      db.seasons,
      db.ecologicalSites,
      db.observations,
      db.media,
    ],
    async () => {
      await db.syncMetadata.put({
        key: `${item.entityType}:${item.entityId}`,
        entityType: item.entityType,
        entityId: item.entityId,
        revision: response.revision,
        serverUpdatedAt: response.serverUpdatedAt,
      })
      await markEntityState(item, 'synced')
      await db.outbox.delete(item.id)
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
      db.ecologicalSites,
      db.observations,
      db.media,
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
      await db.fields.put(fieldSchema.parse(payload))
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
      await db.alerts.put(alertSchema.parse(payload))
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
  const pending = (await db.outbox.orderBy('createdAt').toArray())
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
