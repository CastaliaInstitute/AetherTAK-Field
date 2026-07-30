import { db } from '../data/database'
import { takTransport } from '../platform/tak'
import type { TakOperation } from './operations'
import { operationToCot } from './cot'

export interface QueuedTakEvent {
  id: string
  operation: TakOperation
  xml: string
  createdAt: string
  attempts: number
  lastError: string | null
}

export async function queueTakOperation(operation: TakOperation) {
  const queued: QueuedTakEvent = {
    id: crypto.randomUUID(),
    operation,
    xml: operationToCot(operation),
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  }
  await db.takOutbox.add(queued)
  return queued
}

export async function pendingTakEvents(limit = 100) {
  return db.takOutbox.orderBy('createdAt').limit(limit).toArray()
}

export async function markTakEventSent(id: string) {
  await db.takOutbox.delete(id)
}

export async function markTakEventFailed(id: string, error: string) {
  const queued = await db.takOutbox.get(id)
  if (!queued) return
  await db.takOutbox.update(id, {
    attempts: queued.attempts + 1,
    lastError: error,
  })
}

export interface TakFlushResult {
  sent: number
  failed: number
  remaining: number
}

export async function flushTakOutbox(limit = 100): Promise<TakFlushResult> {
  const pending = await pendingTakEvents(limit)
  let sent = 0
  let failed = 0

  for (const item of pending) {
    try {
      const accepted = await takTransport.sendXml(item.xml)
      if (!accepted) throw new Error('TAK transport did not accept the event.')
      await markTakEventSent(item.id)
      sent += 1
    } catch (error) {
      await markTakEventFailed(
        item.id,
        error instanceof Error ? error.message : 'Unknown TAK transport error.',
      )
      failed += 1
      break
    }
  }

  return {
    sent,
    failed,
    remaining: await db.takOutbox.count(),
  }
}
