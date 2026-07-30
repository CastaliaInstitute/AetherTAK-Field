import { XMLParser } from 'fast-xml-parser'
import type { Coordinate } from '../domain/models'
import type { TakDeviceMetadata, TakOperation } from './operations'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  // Built-in XML entities are required for interoperable GeoChat text.
  // Custom declarations are rejected before parsing below.
  processEntities: true,
  trimValues: false,
})

export const MAX_COT_EVENT_BYTES = 256 * 1024
export const MAX_COT_GEOMETRY_POINTS = 100
const MAX_MISSION_PACKAGE_BYTES = 25 * 1024 * 1024

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const attribute = (name: string, value: string | number | boolean) =>
  `${name}="${escapeXml(String(value))}"`

const iso = (value: string) => new Date(value).toISOString()

function addSeconds(value: string, seconds: number) {
  return new Date(new Date(value).getTime() + seconds * 1_000).toISOString()
}

function point(coordinate: Coordinate) {
  return `<point ${attribute('lat', coordinate.latitude)} ${attribute('lon', coordinate.longitude)} ${attribute('hae', coordinate.altitudeMeters ?? 0)} ${attribute('ce', coordinate.horizontalAccuracyMeters ?? 9999999)} ${attribute('le', coordinate.verticalAccuracyMeters ?? 9999999)}/>`
}

function event(
  uid: string,
  type: string,
  createdAt: string,
  staleSeconds: number,
  coordinate: Coordinate,
  detail: string,
  how = 'h-g-i-g-o',
) {
  const time = iso(createdAt)
  return [
    `<event version="2.0" ${attribute('uid', uid)} ${attribute('type', type)} ${attribute('how', how)} ${attribute('time', time)} ${attribute('start', time)} ${attribute('stale', addSeconds(time, staleSeconds))}>`,
    point(coordinate),
    `<detail>${detail}</detail>`,
    '</event>',
  ].join('')
}

function contactDetail(
  callsign: string,
  team: string,
  role: string,
  device: TakDeviceMetadata | undefined,
  endpoint = '*:-1:stcp',
) {
  const detail = [
    `<contact ${attribute('callsign', callsign)} ${attribute('endpoint', endpoint)}/>`,
    `<__group ${attribute('name', team)} ${attribute('role', role)}/>`,
  ]
  if (device?.batteryPercent !== null && device?.batteryPercent !== undefined) {
    detail.push(
      `<status ${attribute('battery', Math.min(100, Math.max(0, Math.round(device.batteryPercent))))}/>`,
    )
  }
  if (device) {
    detail.push(
      `<takv ${attribute('device', device.model)} ${attribute('platform', device.platform)} ${attribute('os', device.osVersion)} ${attribute('version', device.appVersion)}/>`,
    )
  }
  return detail.join('')
}

function coordinateLinks(points: Coordinate[]) {
  return points
    .map(
      (value, index) =>
        `<link ${attribute('uid', `point-${index + 1}`)} type="b-m-p-w" relation="c" ${attribute('point', `${value.latitude},${value.longitude},${value.altitudeMeters ?? 0}`)}/>`,
    )
    .join('')
}

export function operationToCot(operation: TakOperation): string {
  switch (operation.kind) {
    case 'position': {
      const { identity, coordinate } = operation
      const track = `<track ${attribute('course', coordinate.headingDegrees ?? 0)} ${attribute('speed', operation.speedMetersPerSecond ?? 0)}/>`
      return event(
        operation.uid,
        'a-f-G-U-C',
        operation.createdAt,
        operation.staleSeconds ?? 300,
        coordinate,
        contactDetail(
          identity.callsign,
          identity.team,
          identity.role,
          operation.device,
        ) + track,
        'm-g',
      )
    }
    case 'chat': {
      const sender = operation.sender
      const detail = [
        `<__chat parent="RootContactGroup" groupOwner="false" ${attribute('chatroom', operation.conversationName)} ${attribute('id', operation.conversationId)} ${attribute('messageId', operation.uid)} ${attribute('senderCallsign', sender.callsign)}>`,
        `<chatgrp ${attribute('uid0', sender.uid)} ${attribute('uid1', operation.recipientUid)} ${attribute('id', operation.conversationId)}/></__chat>`,
        `<link ${attribute('uid', sender.uid)} type="a-f-G-U-C" relation="p-p"/>`,
        `<remarks ${attribute('source', `BAO.F.ATAK.${sender.uid}`)} ${attribute('to', operation.recipientUid)} ${attribute('time', iso(operation.createdAt))}>${escapeXml(operation.message)}</remarks>`,
      ].join('')
      return event(
        operation.uid,
        'b-t-f',
        operation.createdAt,
        operation.staleSeconds ?? 86_400,
        {
          latitude: 0,
          longitude: 0,
          altitudeMeters: 0,
          horizontalAccuracyMeters: 9999999,
          verticalAccuracyMeters: 9999999,
          headingDegrees: null,
        },
        detail,
      )
    }
    case 'marker': {
      const detail =
        `<contact ${attribute('callsign', operation.callsign)}/>` +
        (operation.remarks
          ? `<remarks>${escapeXml(operation.remarks)}</remarks>`
          : '')
      return event(
        operation.uid,
        operation.cotType ?? 'a-u-G',
        operation.createdAt,
        operation.staleSeconds ?? 300,
        operation.coordinate,
        detail,
      )
    }
    case 'route': {
      if (operation.points.length < 2) {
        throw new Error('A TAK route requires at least two points.')
      }
      const detail = [
        `<contact ${attribute('callsign', operation.title)}/>`,
        `<link_attr ${attribute('color', operation.colorArgb)} stroke="4" type="Vehicle" method="Driving" direction="Infil" routetype="Primary" order="Ascending" planningmethod="Infil" prefix="CP"/>`,
        coordinateLinks(operation.points),
      ].join('')
      return event(
        operation.uid,
        'b-m-r',
        operation.createdAt,
        operation.staleSeconds ?? 300,
        operation.points[0],
        detail,
      )
    }
    case 'shape': {
      if (operation.points.length < (operation.closed ? 3 : 2)) {
        throw new Error('The shape does not contain enough points.')
      }
      const vertices = operation.points
        .map(
          (value) =>
            `<vertex ${attribute('lat', value.latitude)} ${attribute('lon', value.longitude)} ${attribute('hae', value.altitudeMeters ?? 0)}/>`,
        )
        .join('')
      const detail = [
        `<contact ${attribute('callsign', operation.title)}/>`,
        `<strokeColor ${attribute('value', operation.colorArgb)}/>`,
        `<shape><polyline ${attribute('closed', operation.closed)} ${attribute('color', operation.colorArgb)} fillColor="0">${vertices}</polyline></shape>`,
      ].join('')
      return event(
        operation.uid,
        'u-d-f',
        operation.createdAt,
        operation.staleSeconds ?? 300,
        operation.points[0],
        detail,
      )
    }
    case 'emergency': {
      const { identity, coordinate } = operation
      const cancel = operation.emergencyType === 'Cancel'
      const detail = cancel
        ? `<emergency cancel="true">${escapeXml(identity.callsign)}</emergency>`
        : [
            `<link ${attribute('uid', identity.uid)} type="a-f-G-U-C" relation="p-p"/>`,
            `<contact ${attribute('callsign', `${identity.callsign}-Alert`)}/>`,
            `<emergency ${attribute('type', operation.emergencyType)}>${escapeXml(identity.callsign)}</emergency>`,
          ].join('')
      return event(
        operation.uid,
        cancel ? 'b-a-o-can' : 'b-a-o-tbl',
        operation.createdAt,
        operation.staleSeconds ?? (cancel ? 60 : 600),
        coordinate,
        detail,
      )
    }
    case 'missionPackage': {
      if (!operation.upload) {
        throw new Error('Upload the mission package before encoding its CoT request.')
      }
      const detail = [
        `<fileshare ${attribute('filename', operation.fileName)} ${attribute('name', operation.transferName)} ${attribute('senderCallsign', operation.sender.callsign)} ${attribute('senderUid', operation.sender.uid)} ${attribute('senderUrl', operation.upload.senderUrl)} ${attribute('sha256', operation.upload.sha256)} ${attribute('sizeInBytes', operation.upload.sizeBytes)}/>`,
        `<ackrequest ${attribute('uid', operation.ackUid)} ackrequested="true" ${attribute('tag', operation.transferName)}/>`,
        `<marti><dest ${attribute('callsign', operation.recipientCallsign)}/></marti>`,
      ].join('')
      return event(
        operation.uid,
        'b-f-t-r',
        operation.createdAt,
        operation.staleSeconds ?? 10,
        operation.coordinate,
        detail,
        'h-e',
      )
    }
    case 'missionPackageAck': {
      const detail = [
        `<ackresponse ${attribute('uid', operation.ackUid)} ${attribute('senderUid', operation.sender.uid)} ${attribute('success', operation.success)} ${attribute('tag', operation.transferName)} ${attribute('reason', operation.reason)} ${attribute('sha256', operation.sha256)} ${attribute('sizeInBytes', operation.sizeBytes)}/>`,
        `<marti><dest ${attribute('callsign', operation.recipientCallsign)}/></marti>`,
      ].join('')
      return event(
        operation.uid,
        'b-f-t-a',
        operation.createdAt,
        operation.staleSeconds ?? 10,
        operation.coordinate,
        detail,
        'm-g',
      )
    }
  }
}

export interface ParsedCotFileTransfer {
  mode: 'request' | 'ack'
  fileName: string
  transferName: string
  senderCallsign: string
  senderUid: string
  senderUrl: string | null
  sha256: string
  sizeBytes: number
  ackUid: string
  success: boolean | null
  reason: string | null
}

export interface ParsedCotEvent {
  uid: string
  type: string
  kind: TakOperation['kind']
  time: string
  stale: string
  coordinate: Coordinate
  points: Coordinate[]
  closed: boolean | null
  callsign: string | null
  remarks: string | null
  emergencyType: string | null
  fileTransfer: ParsedCotFileTransfer | null
  raw: string
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function values(value: unknown) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value
  const content = record(value)['#text']
  return typeof content === 'string' ? content : null
}

function operationKind(type: string): TakOperation['kind'] {
  if (type === 'b-f-t-r') return 'missionPackage'
  if (type === 'b-f-t-a') return 'missionPackageAck'
  if (type === 'b-t-f') return 'chat'
  if (type === 'b-m-r') return 'route'
  if (type === 'u-d-f') return 'shape'
  if (type.startsWith('b-a-o-')) return 'emergency'
  if (type.startsWith('a-f-')) return 'position'
  return 'marker'
}

function requiredBoundedString(
  value: unknown,
  label: string,
  maximumLength: number,
) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new Error(`Invalid CoT ${label}.`)
  }
  return value
}

function optionalBoundedString(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return null
  return value.length <= maximumLength ? value : null
}

function cotTimestamp(value: unknown, label: string) {
  const timestamp = requiredBoundedString(value, label, 64)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid CoT ${label}.`)
  }
  return timestamp
}

function coordinateNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid CoT ${label}.`)
  }
  return parsed
}

function optionalCoordinateNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number | null,
) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}

function geometryCoordinate(
  latitude: unknown,
  longitude: unknown,
  altitude: unknown,
): Coordinate {
  return {
    latitude: coordinateNumber(latitude, 'latitude', -90, 90),
    longitude: coordinateNumber(longitude, 'longitude', -180, 180),
    altitudeMeters: optionalCoordinateNumber(
      altitude,
      -20_000,
      100_000,
      null,
    ),
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  }
}

function geometryValues(value: unknown, label: string) {
  const items = values(value)
  if (items.length > MAX_COT_GEOMETRY_POINTS) {
    throw new Error(`CoT ${label} exceeds the geometry point limit.`)
  }
  return items
}

export function parseCotEvent(xml: string): ParsedCotEvent {
  if (
    new TextEncoder().encode(xml).byteLength > MAX_COT_EVENT_BYTES
  ) {
    throw new Error('CoT event exceeds the size limit.')
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('CoT document declarations are not allowed.')
  }
  const result = parser.parse(xml) as {
    event?: {
      uid?: unknown
      type?: unknown
      time?: unknown
      stale?: unknown
      point?: Record<string, unknown>
      detail?: Record<string, unknown>
    }
  }
  const value = result.event
  if (!value) {
    throw new Error('Invalid CoT event.')
  }
  const uid = requiredBoundedString(value.uid, 'UID', 256)
  const type = requiredBoundedString(value.type, 'type', 128)
  const time = cotTimestamp(value.time, 'time')
  const stale = cotTimestamp(value.stale, 'stale time')
  if (Date.parse(stale) < Date.parse(time)) {
    throw new Error('Invalid CoT stale time.')
  }
  const pointValue = value.point ?? {}
  const detail = value.detail ?? {}
  const contact = record(detail.contact)
  const chat = record(detail.__chat)
  const emergency = record(detail.emergency)
  const fileshare = record(detail.fileshare)
  const ackrequest = record(detail.ackrequest)
  const ackresponse = record(detail.ackresponse)
  const track = record(detail.track)
  const coordinate: Coordinate = {
    latitude: coordinateNumber(pointValue.lat, 'latitude', -90, 90),
    longitude: coordinateNumber(pointValue.lon, 'longitude', -180, 180),
    altitudeMeters: optionalCoordinateNumber(
      pointValue.hae,
      -20_000,
      100_000,
      null,
    ),
    horizontalAccuracyMeters: optionalCoordinateNumber(
      pointValue.ce,
      0,
      10_000_000,
      9_999_999,
    ),
    verticalAccuracyMeters: optionalCoordinateNumber(
      pointValue.le,
      0,
      10_000_000,
      9_999_999,
    ),
    headingDegrees: optionalCoordinateNumber(track.course, 0, 360, null),
  }
  const kind = operationKind(type)
  let points: Coordinate[] = [coordinate]
  let closed: boolean | null = null
  if (kind === 'route') {
    points = geometryValues(detail.link, 'route').flatMap((linkValue) => {
      const rawPoint = record(linkValue).point
      if (typeof rawPoint !== 'string') return []
      const [latitude, longitude, altitude] = rawPoint
        .split(',')
      return [geometryCoordinate(latitude, longitude, altitude)]
    })
    if (points.length < 2) throw new Error('Invalid CoT route geometry.')
  }
  if (kind === 'shape') {
    const shape = record(detail.shape)
    const polyline = record(shape.polyline)
    closed =
      polyline.closed === undefined
        ? null
        : String(polyline.closed).toLowerCase() === 'true'
    points = geometryValues(polyline.vertex, 'shape').map((vertexValue) => {
      const vertex = record(vertexValue)
      return geometryCoordinate(vertex.lat, vertex.lon, vertex.hae)
    })
    const minimum = closed ? 3 : 2
    if (points.length < minimum) throw new Error('Invalid CoT shape geometry.')
  }
  let fileTransfer: ParsedCotFileTransfer | null = null
  if (kind === 'missionPackage') {
    const sizeBytes = Number(fileshare.sizeInBytes)
    if (
      typeof fileshare.filename === 'string' &&
      typeof fileshare.name === 'string' &&
      typeof fileshare.senderCallsign === 'string' &&
      typeof fileshare.senderUid === 'string' &&
      typeof fileshare.senderUrl === 'string' &&
      typeof fileshare.sha256 === 'string' &&
      /^[0-9a-f]{64}$/i.test(fileshare.sha256) &&
      Number.isSafeInteger(sizeBytes) &&
      sizeBytes >= 1 &&
      sizeBytes <= MAX_MISSION_PACKAGE_BYTES &&
      fileshare.filename.length <= 255 &&
      fileshare.name.length <= 128 &&
      fileshare.senderCallsign.length <= 128 &&
      fileshare.senderUid.length <= 256 &&
      fileshare.senderUrl.length <= 2_048
    ) {
      fileTransfer = {
        mode: 'request',
        fileName: fileshare.filename,
        transferName: fileshare.name,
        senderCallsign: fileshare.senderCallsign,
        senderUid: fileshare.senderUid,
        senderUrl: fileshare.senderUrl,
        sha256: fileshare.sha256.toLowerCase(),
        sizeBytes,
        ackUid: typeof ackrequest.uid === 'string' ? ackrequest.uid : '',
        success: null,
        reason: null,
      }
    }
  }
  if (kind === 'missionPackageAck') {
    const sizeBytes = Number(ackresponse.sizeInBytes)
    if (
      typeof ackresponse.uid === 'string' &&
      typeof ackresponse.senderUid === 'string' &&
      typeof ackresponse.sha256 === 'string' &&
      /^[0-9a-f]{64}$/i.test(ackresponse.sha256) &&
      Number.isSafeInteger(sizeBytes) &&
      sizeBytes >= 1 &&
      sizeBytes <= MAX_MISSION_PACKAGE_BYTES &&
      ackresponse.uid.length <= 256 &&
      ackresponse.senderUid.length <= 256
    ) {
      fileTransfer = {
        mode: 'ack',
        fileName: '',
        transferName:
          typeof ackresponse.tag === 'string' ? ackresponse.tag : 'Mission package',
        senderCallsign: '',
        senderUid: ackresponse.senderUid,
        senderUrl: null,
        sha256: ackresponse.sha256.toLowerCase(),
        sizeBytes,
        ackUid: ackresponse.uid,
        success: String(ackresponse.success).toLowerCase() === 'true',
        reason: optionalBoundedString(ackresponse.reason, 512),
      }
    }
  }

  const contactCallsign = optionalBoundedString(contact.callsign, 128)
  const chatCallsign = optionalBoundedString(chat.senderCallsign, 128)
  const emergencyCallsign = optionalBoundedString(text(emergency), 128)
  const emergencyType = optionalBoundedString(emergency.type, 128)
  return {
    uid,
    type,
    kind,
    time,
    stale,
    coordinate,
    points,
    closed,
    callsign: contactCallsign ?? chatCallsign ?? emergencyCallsign,
    remarks: optionalBoundedString(text(detail.remarks), 4_096),
    emergencyType:
      emergency.cancel === 'true'
        ? 'Cancel'
        : emergencyType,
    fileTransfer,
    raw: xml,
  }
}
