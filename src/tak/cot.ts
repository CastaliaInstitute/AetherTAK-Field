import { XMLParser } from 'fast-xml-parser'
import type { Coordinate } from '../domain/models'
import type { TakOperation } from './operations'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  trimValues: false,
})

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
  endpoint = '*:-1:stcp',
) {
  return [
    `<contact ${attribute('callsign', callsign)} ${attribute('endpoint', endpoint)}/>`,
    `<__group ${attribute('name', team)} ${attribute('role', role)}/>`,
    '<status battery="100"/>',
    '<takv device="AetherTAK Field" platform="Capacitor" os="mobile" version="0.1.0"/>',
  ].join('')
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
  }
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
  if (type === 'b-t-f') return 'chat'
  if (type === 'b-m-r') return 'route'
  if (type === 'u-d-f') return 'shape'
  if (type.startsWith('b-a-o-')) return 'emergency'
  if (type.startsWith('a-f-')) return 'position'
  return 'marker'
}

export function parseCotEvent(xml: string): ParsedCotEvent {
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
  if (!value || typeof value.uid !== 'string' || typeof value.type !== 'string') {
    throw new Error('Invalid CoT event.')
  }
  const numeric = (input: unknown, fallback: number) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const pointValue = value.point ?? {}
  const detail = value.detail ?? {}
  const contact = record(detail.contact)
  const chat = record(detail.__chat)
  const emergency = record(detail.emergency)
  const track = record(detail.track)
  const coordinate: Coordinate = {
    latitude: numeric(pointValue.lat, 0),
    longitude: numeric(pointValue.lon, 0),
    altitudeMeters: numeric(pointValue.hae, 0),
    horizontalAccuracyMeters: numeric(pointValue.ce, 9999999),
    verticalAccuracyMeters: numeric(pointValue.le, 9999999),
    headingDegrees:
      track.course === undefined
        ? null
        : numeric(track.course, 0),
  }
  const kind = operationKind(value.type)
  let points: Coordinate[] = [coordinate]
  let closed: boolean | null = null
  if (kind === 'route') {
    points = values(detail.link).flatMap((linkValue) => {
      const rawPoint = record(linkValue).point
      if (typeof rawPoint !== 'string') return []
      const [latitude, longitude, altitude] = rawPoint
        .split(',')
        .map(Number)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
      return [{
        latitude,
        longitude,
        altitudeMeters: Number.isFinite(altitude) ? altitude : null,
        horizontalAccuracyMeters: null,
        verticalAccuracyMeters: null,
        headingDegrees: null,
      }]
    })
  }
  if (kind === 'shape') {
    const shape = record(detail.shape)
    const polyline = record(shape.polyline)
    closed =
      polyline.closed === undefined
        ? null
        : String(polyline.closed).toLowerCase() === 'true'
    points = values(polyline.vertex).flatMap((vertexValue) => {
      const vertex = record(vertexValue)
      const latitude = Number(vertex.lat)
      const longitude = Number(vertex.lon)
      const altitude = Number(vertex.hae)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
      return [{
        latitude,
        longitude,
        altitudeMeters: Number.isFinite(altitude) ? altitude : null,
        horizontalAccuracyMeters: null,
        verticalAccuracyMeters: null,
        headingDegrees: null,
      }]
    })
  }

  return {
    uid: value.uid,
    type: value.type,
    kind,
    time: String(value.time ?? ''),
    stale: String(value.stale ?? ''),
    coordinate,
    points,
    closed,
    callsign:
      typeof contact.callsign === 'string'
        ? contact.callsign
        : typeof chat.senderCallsign === 'string'
          ? chat.senderCallsign
          : text(emergency),
    remarks: text(detail.remarks),
    emergencyType:
      emergency.cancel === 'true'
        ? 'Cancel'
        : typeof emergency.type === 'string'
          ? emergency.type
          : null,
    raw: xml,
  }
}
