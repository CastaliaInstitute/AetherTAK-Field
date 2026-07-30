import { z } from 'zod'
import {
  db,
  type GuardianActionOutbox,
} from '../data/database'
import {
  fieldApiTransport,
  type NativeFieldResponse,
} from '../platform/tak'

const guardianActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      idempotencyKey: z.string().uuid(),
      kind: z.literal('check_in'),
      targetId: z.string().uuid(),
      reason: z.null(),
      occurredAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      idempotencyKey: z.string().uuid(),
      kind: z.literal('acknowledge'),
      targetId: z.string().uuid(),
      reason: z.null(),
      occurredAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      idempotencyKey: z.string().uuid(),
      kind: z.literal('resolve'),
      targetId: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
      occurredAt: z.string().datetime(),
    })
    .strict(),
])

const guardianActionReceiptSchema = z
  .object({
    accepted: z.literal(true),
    idempotencyKey: z.string().uuid(),
    action: z.enum(['check_in', 'acknowledge', 'resolve']),
    targetId: z.string().uuid(),
    serverTime: z.string().datetime(),
    entityVersion: z.number().int().positive(),
    idempotentReplay: z.boolean(),
  })
  .strict()

export interface GuardianActionTransport {
  guardianAction(
    action: Record<string, unknown>,
  ): Promise<NativeFieldResponse>
}

export interface GuardianActionFlushResult {
  sent: number
  failed: number
  remaining: number
}

function portableAction(item: GuardianActionOutbox) {
  return guardianActionSchema.parse({
    idempotencyKey: item.id,
    kind: item.kind,
    targetId: item.targetId,
    reason: item.reason,
    occurredAt: item.createdAt,
  })
}

function retryAt(attempts: number, now: Date, permanent: boolean) {
  const seconds = permanent
    ? 24 * 60 * 60
    : Math.min(60 * 60, 5 * 2 ** Math.min(attempts, 10))
  return new Date(now.getTime() + seconds * 1_000).toISOString()
}

function responseMessage(response: NativeFieldResponse) {
  const error = response.body.error
  if (typeof error === 'object' && error && 'message' in error) {
    return String(error.message)
  }
  return `Guardian API returned HTTP ${response.status}.`
}

export async function queueGuardianAction(input: {
  kind: GuardianActionOutbox['kind']
  targetId: string
  reason?: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const item: GuardianActionOutbox = {
    id: crypto.randomUUID(),
    kind: input.kind,
    targetId: input.targetId,
    reason: input.reason ?? null,
    createdAt: now.toISOString(),
    attempts: 0,
    lastError: null,
    nextAttemptAt: now.toISOString(),
  }
  portableAction(item)
  await db.guardianActions.add(item)
  return item
}

export async function flushGuardianActions(
  transport: GuardianActionTransport = fieldApiTransport,
  now = new Date(),
): Promise<GuardianActionFlushResult> {
  const pending = (await db.guardianActions.orderBy('createdAt').toArray())
    .filter((item) => new Date(item.nextAttemptAt).getTime() <= now.getTime())
  let sent = 0
  let failed = 0

  for (const item of pending) {
    try {
      const action = portableAction(item)
      const response = await transport.guardianAction(action)
      if (response.status < 200 || response.status >= 300) {
        const error = new Error(responseMessage(response)) as Error & {
          status?: number
        }
        error.status = response.status
        throw error
      }
      const receipt = guardianActionReceiptSchema.parse(response.body)
      if (
        receipt.idempotencyKey !== item.id ||
        receipt.action !== item.kind ||
        receipt.targetId !== item.targetId
      ) {
        throw new Error('Guardian API acknowledged a different action.')
      }
      await db.guardianActions.delete(item.id)
      sent += 1
    } catch (error) {
      const status =
        error instanceof Error && 'status' in error
          ? Number(error.status)
          : 0
      const permanent =
        status >= 400 && status < 500 && status !== 408 && status !== 429
      const attempts = item.attempts + 1
      await db.guardianActions.update(item.id, {
        attempts,
        lastError:
          error instanceof Error
            ? error.message
            : 'Unknown Guardian action error.',
        nextAttemptAt: retryAt(attempts, now, permanent),
      })
      failed += 1
      if (!permanent) break
    }
  }

  return {
    sent,
    failed,
    remaining: await db.guardianActions.count(),
  }
}

export async function retryGuardianAction(id: string, now = new Date()) {
  const updated = await db.guardianActions.update(id, {
    attempts: 0,
    lastError: null,
    nextAttemptAt: now.toISOString(),
  })
  if (!updated) throw new Error('Guardian action no longer exists.')
}

export async function discardGuardianAction(id: string) {
  await db.guardianActions.delete(id)
}
