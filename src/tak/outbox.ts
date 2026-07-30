import { db } from '../data/database'
import { takTransport } from '../platform/tak'
import type { TakOperation } from './operations'
import { operationToCot } from './cot'
import { activityFromOperation } from './activity'
import { removePersistedMissionPackage } from './missionPackage'

export interface QueuedTakEvent {
  id: string
  operation: TakOperation
  xml: string
  createdAt: string
  attempts: number
  lastError: string | null
}

export async function queueTakOperation(operation: TakOperation) {
  const id = crypto.randomUUID()
  const xml =
    operation.kind === 'missionPackage' && !operation.upload
      ? ''
      : operationToCot(operation)
  const queued: QueuedTakEvent = {
    id,
    operation,
    xml,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  }
  await db.transaction('rw', [db.takOutbox, db.takActivity], async () => {
    if (operation.kind === 'position') {
      const superseded = await db.takOutbox
        .where('operation.kind')
        .equals('position')
        .filter((item) => item.operation.uid === operation.uid)
        .primaryKeys()
      await db.takOutbox.bulkDelete(superseded)
    }
    await db.takOutbox.add(queued)
    await db.takActivity.put(activityFromOperation(operation, xml, id))
  })
  return queued
}

export async function pendingTakEvents(limit = 100) {
  return db.takOutbox.orderBy('createdAt').limit(limit).toArray()
}

export async function markTakEventSent(id: string) {
  await db.transaction('rw', [db.takOutbox, db.takActivity], async () => {
    await db.takOutbox.delete(id)
    await db.takActivity.where('outboxId').equals(id).modify({
      deliveryStatus: 'sent',
      outboxId: null,
    })
  })
}

export async function markTakEventFailed(id: string, error: string) {
  const queued = await db.takOutbox.get(id)
  if (!queued) return
  await db.transaction('rw', [db.takOutbox, db.takActivity], async () => {
    await db.takOutbox.update(id, {
      attempts: queued.attempts + 1,
      lastError: error,
    })
    await db.takActivity.where('outboxId').equals(id).modify({
      deliveryStatus: 'failed',
    })
  })
}

async function prepareMissionPackage(item: QueuedTakEvent) {
  if (item.operation.kind !== 'missionPackage' || item.operation.upload) {
    return item
  }
  const upload = await takTransport.uploadMissionPackage({
    uri: item.operation.localUri,
    fileName: item.operation.fileName,
    creatorUid: item.operation.sender.uid,
  })
  const operation: TakOperation = {
    ...item.operation,
    upload,
  }
  const xml = operationToCot(operation)
  const prepared = { ...item, operation, xml }
  await db.transaction('rw', [db.takOutbox, db.takActivity], async () => {
    await db.takOutbox.put(prepared)
    await db.takActivity.where('outboxId').equals(item.id).modify((activity) => {
      activity.xml = xml
      if (activity.fileTransfer) {
        activity.fileTransfer.senderUrl = upload.senderUrl
        activity.fileTransfer.sha256 = upload.sha256
        activity.fileTransfer.sizeBytes = upload.sizeBytes
      }
    })
  })
  return prepared
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

  for (const queued of pending) {
    try {
      const item = await prepareMissionPackage(queued)
      const accepted = await takTransport.sendXml(item.xml)
      if (!accepted) throw new Error('TAK transport did not accept the event.')
      await markTakEventSent(item.id)
      if (item.operation.kind === 'missionPackage') {
        await removePersistedMissionPackage(
          item.operation.storagePath,
        ).catch(() => undefined)
      }
      sent += 1
    } catch (error) {
      await markTakEventFailed(
        queued.id,
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
