import { z } from 'zod'
import {
  db,
  type OutboxItem,
  type ServerEntity,
} from '../data/database'
import {
  mediaCaptureSchema,
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
}

export interface FieldFlushResult {
  sent: number
  conflicts: number
  failed: number
  remaining: number
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
