import type { Coordinate } from '../domain/models'
import { db } from '../data/database'
import { parseCotEvent } from './cot'
import type { TakOperation, TakOperationKind } from './operations'

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
      }
    case 'chat':
      return {
        title: operation.conversationName,
        message: operation.message,
        coordinate: zeroCoordinate,
        points: [],
      }
    case 'marker':
      return {
        title: operation.callsign,
        message: operation.remarks ?? null,
        coordinate: operation.coordinate,
        points: [operation.coordinate],
      }
    case 'route':
      return {
        title: operation.title,
        message: null,
        coordinate: operation.points[0],
        points: operation.points,
      }
    case 'shape':
      return {
        title: operation.title,
        message: null,
        coordinate: operation.points[0],
        points: operation.points,
      }
    case 'emergency':
      return {
        title: operation.emergencyType,
        message: operation.identity.callsign,
        coordinate: operation.coordinate,
        points: [operation.coordinate],
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
    createdAt: event.time,
    staleAt: event.stale,
    deliveryStatus: 'received',
    xml,
  }
}

export async function recordInboundCot(xml: string) {
  const activity = activityFromCot(xml)
  await db.takActivity.put(activity)
  return activity
}

export async function recentTakActivity(limit = 200) {
  return db.takActivity.orderBy('createdAt').reverse().limit(limit).toArray()
}
