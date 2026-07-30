import type { Coordinate } from '../domain/models'
import { db } from '../data/database'
import { parseCotEvent } from './cot'
import type { TakOperation, TakOperationKind } from './operations'

export interface TakFileTransferActivity {
  mode: 'outbound' | 'request' | 'ack'
  fileName: string
  transferName: string
  senderCallsign: string
  senderUid: string
  senderUrl: string | null
  sha256: string | null
  sizeBytes: number
  ackUid: string
  localUri: string | null
  status: 'queued' | 'available' | 'downloaded' | 'acknowledged' | 'failed'
  success: boolean | null
  reason: string | null
}

export type TakDeliveryStatus = 'queued' | 'sent' | 'failed' | 'received'

export interface TakActivity {
  id: string
  uid: string
  outboxId: string | null
  direction: 'outbound' | 'inbound'
  kind: TakOperationKind
  title: string
  message: string | null
  coordinate: Coordinate
  points: Coordinate[]
  closed: boolean | null
  fileTransfer: TakFileTransferActivity | null
  createdAt: string
  staleAt: string
  deliveryStatus: TakDeliveryStatus
  xml: string
}

const zeroCoordinate: Coordinate = {
  latitude: 0,
  longitude: 0,
  altitudeMeters: null,
  horizontalAccuracyMeters: null,
  verticalAccuracyMeters: null,
  headingDegrees: null,
}

function addSeconds(value: string, seconds: number) {
  return new Date(new Date(value).getTime() + seconds * 1_000).toISOString()
}

function operationPresentation(operation: TakOperation) {
  switch (operation.kind) {
    case 'position':
      return {
        title: operation.identity.callsign,
        message: null,
        coordinate: operation.coordinate,
        points: [operation.coordinate],
        closed: null,
        fileTransfer: null,
      }
    case 'chat':
      return {
        title: operation.conversationName,
        message: operation.message,
        coordinate: zeroCoordinate,
        points: [],
        closed: null,
        fileTransfer: null,
      }
    case 'marker':
      return {
        title: operation.callsign,
        message: operation.remarks ?? null,
        coordinate: operation.coordinate,
        points: [operation.coordinate],
        closed: null,
        fileTransfer: null,
      }
    case 'route':
      return {
        title: operation.title,
        message: null,
        coordinate: operation.points[0],
        points: operation.points,
        closed: null,
        fileTransfer: null,
      }
    case 'shape':
      return {
        title: operation.title,
        message: null,
        coordinate: operation.points[0],
        points: operation.points,
        closed: operation.closed,
        fileTransfer: null,
      }
    case 'emergency':
      return {
        title: operation.emergencyType,
        message: operation.identity.callsign,
        coordinate: operation.coordinate,
        points: [operation.coordinate],
        closed: null,
        fileTransfer: null,
      }
    case 'missionPackage':
      return {
        title: operation.transferName,
        message: `${operation.fileName} → ${operation.recipientCallsign}`,
        coordinate: operation.coordinate,
        points: [],
        closed: null,
        fileTransfer: {
          mode: 'outbound' as const,
          fileName: operation.fileName,
          transferName: operation.transferName,
          senderCallsign: operation.sender.callsign,
          senderUid: operation.sender.uid,
          senderUrl: operation.upload?.senderUrl ?? null,
          sha256: operation.upload?.sha256 ?? null,
          sizeBytes: operation.upload?.sizeBytes ?? 0,
          ackUid: operation.ackUid,
          localUri: operation.localUri,
          status: 'queued' as const,
          success: null,
          reason: null,
        },
      }
    case 'missionPackageAck':
      return {
        title: operation.transferName,
        message: operation.success
          ? 'Package received by peer'
          : operation.reason,
        coordinate: operation.coordinate,
        points: [],
        closed: null,
        fileTransfer: {
          mode: 'ack' as const,
          fileName: '',
          transferName: operation.transferName,
          senderCallsign: operation.sender.callsign,
          senderUid: operation.sender.uid,
          senderUrl: null,
          sha256: operation.sha256,
          sizeBytes: operation.sizeBytes,
          ackUid: operation.ackUid,
          localUri: null,
          status: operation.success ? 'acknowledged' as const : 'failed' as const,
          success: operation.success,
          reason: operation.reason,
        },
      }
  }
}

export function activityFromOperation(
  operation: TakOperation,
  xml: string,
  outboxId: string,
): TakActivity {
  const presentation = operationPresentation(operation)
  return {
    id: `outbound:${operation.uid}`,
    uid: operation.uid,
    outboxId,
    direction: 'outbound',
    kind: operation.kind,
    ...presentation,
    createdAt: operation.createdAt,
    staleAt: addSeconds(
      operation.createdAt,
      operation.staleSeconds ?? 300,
    ),
    deliveryStatus: 'queued',
    xml,
  }
}

export function activityFromCot(xml: string): TakActivity {
  const event = parseCotEvent(xml)
  return {
    id: `inbound:${event.uid}`,
    uid: event.uid,
    outboxId: null,
    direction: 'inbound',
    kind: event.kind,
    title: event.emergencyType ?? event.callsign ?? event.kind,
    message: event.remarks,
    coordinate: event.coordinate,
    points: event.points,
    closed: event.closed,
    fileTransfer: event.fileTransfer
      ? {
          mode: event.fileTransfer.mode,
          fileName: event.fileTransfer.fileName,
          transferName: event.fileTransfer.transferName,
          senderCallsign: event.fileTransfer.senderCallsign,
          senderUid: event.fileTransfer.senderUid,
          senderUrl: event.fileTransfer.senderUrl,
          sha256: event.fileTransfer.sha256,
          sizeBytes: event.fileTransfer.sizeBytes,
          ackUid: event.fileTransfer.ackUid,
          localUri: null,
          status:
            event.fileTransfer.mode === 'request'
              ? 'available'
              : event.fileTransfer.success
                ? 'acknowledged'
                : 'failed',
          success: event.fileTransfer.success,
          reason: event.fileTransfer.reason,
        }
      : null,
    createdAt: event.time,
    staleAt: event.stale,
    deliveryStatus: 'received',
    xml,
  }
}

export async function recordInboundCot(xml: string) {
  const activity = activityFromCot(xml)
  await db.transaction('rw', db.takActivity, async () => {
    await db.takActivity.put(activity)
    const receipt = activity.fileTransfer
    if (receipt?.mode !== 'ack') return
    await db.takActivity
      .filter(
        (candidate) =>
          candidate.fileTransfer?.mode === 'outbound' &&
          candidate.fileTransfer.ackUid === receipt.ackUid,
      )
      .modify((candidate) => {
        if (!candidate.fileTransfer) return
        candidate.fileTransfer.success = receipt.success
        candidate.fileTransfer.reason = receipt.reason
        candidate.fileTransfer.status = receipt.success
          ? 'acknowledged'
          : 'failed'
      })
  })
  return activity
}

export async function recentTakActivity(limit = 200) {
  return db.takActivity.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function markMissionPackageDownloaded(
  id: string,
  localUri: string,
) {
  await db.takActivity.where('id').equals(id).modify((activity) => {
    if (!activity.fileTransfer) return
    activity.fileTransfer.localUri = localUri
    activity.fileTransfer.status = 'downloaded'
  })
}
