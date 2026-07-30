import { describe, expect, it } from 'vitest'
import type { Coordinate } from '../domain/models'
import {
  MAX_COT_EVENT_BYTES,
  MAX_COT_GEOMETRY_POINTS,
  operationToCot,
  parseCotEvent,
} from './cot'
import type { TakIdentity, TakOperation } from './operations'

const coordinate: Coordinate = {
  latitude: 39.7408,
  longitude: -104.9937,
  altitudeMeters: 1608,
  horizontalAccuracyMeters: 4,
  verticalAccuracyMeters: 7,
  headingDegrees: 82,
}

const identity: TakIdentity = {
  uid: 'AETHER-FIELD-01',
  callsign: 'Field One',
  team: 'Green',
  role: 'Team Member',
}

const createdAt = '2026-07-30T05:00:00.000Z'

describe('TAK Cursor-on-Target codec', () => {
  it('builds and parses a standard PLI event', () => {
    const xml = operationToCot({
      kind: 'position',
      uid: identity.uid,
      identity,
      coordinate,
      device: {
        model: 'iPhone',
        platform: 'iOS',
        osVersion: '18.5',
        appVersion: '2.4.1',
        batteryPercent: 73,
      },
      createdAt,
    })
    const parsed = parseCotEvent(xml)

    expect(parsed.uid).toBe(identity.uid)
    expect(parsed.type).toBe('a-f-G-U-C')
    expect(parsed.callsign).toBe('Field One')
    expect(parsed.coordinate).toMatchObject({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    })
    expect(xml).toContain('<__group name="Green" role="Team Member"/>')
    expect(xml).toContain('<status battery="73"/>')
    expect(xml).toContain(
      '<takv device="iPhone" platform="iOS" os="18.5" version="2.4.1"/>',
    )
  })

  it('omits unavailable device telemetry instead of fabricating it', () => {
    const xml = operationToCot({
      kind: 'position',
      uid: identity.uid,
      identity,
      coordinate,
      createdAt,
    })

    expect(xml).not.toContain('<status')
    expect(xml).not.toContain('<takv')
    expect(xml).not.toContain('battery="100"')
    expect(xml).not.toContain('version="0.1.0"')
  })

  it('escapes GeoChat content and addresses the recipient', () => {
    const xml = operationToCot({
      kind: 'chat',
      uid: 'GeoChat.AETHER-FIELD-01.team-1.message-1',
      sender: identity,
      recipientUid: 'team-1',
      conversationId: 'team-1',
      conversationName: 'Field Team',
      message: 'Creek < 0.5m & falling',
      createdAt,
    })

    expect(xml).toContain('type="b-t-f"')
    expect(xml).toContain('uid1="team-1"')
    expect(xml).toContain('Creek &lt; 0.5m &amp; falling')
    const parsed = parseCotEvent(xml)
    expect(parsed).toMatchObject({
      kind: 'chat',
      callsign: 'Field One',
      remarks: 'Creek < 0.5m & falling',
    })
  })

  it.each([
    {
      kind: 'marker',
      uid: 'marker-1',
      callsign: 'Dry patch',
      coordinate,
      remarks: 'Inspect tomorrow',
      createdAt,
      expectedType: 'a-u-G',
    },
    {
      kind: 'route',
      uid: 'route-1',
      title: 'Irrigation walk',
      colorArgb: -16711936,
      points: [coordinate, { ...coordinate, latitude: 39.741 }],
      createdAt,
      expectedType: 'b-m-r',
    },
    {
      kind: 'shape',
      uid: 'shape-1',
      title: 'Treatment zone',
      colorArgb: -256,
      closed: true,
      points: [
        coordinate,
        { ...coordinate, latitude: 39.741 },
        { ...coordinate, longitude: -104.994 },
      ],
      createdAt,
      expectedType: 'u-d-f',
    },
    {
      kind: 'emergency',
      uid: 'emergency-1',
      identity,
      coordinate,
      emergencyType: 'Medical',
      createdAt,
      expectedType: 'b-a-o-tbl',
    },
  ] as Array<TakOperation & { expectedType: string }>)(
    'builds $kind operations as $expectedType',
    ({ expectedType, ...operation }) => {
      const parsed = parseCotEvent(operationToCot(operation as TakOperation))
      expect(parsed.type).toBe(expectedType)
      expect(parsed.kind).toBe(operation.kind)
      if (operation.kind === 'route' || operation.kind === 'shape') {
        expect(parsed.points).toHaveLength(operation.points.length)
      }
    },
  )

  it('rejects malformed events and invalid route geometry', () => {
    expect(() => parseCotEvent('<event/>')).toThrow('Invalid CoT event')
    expect(() =>
      operationToCot({
        kind: 'route',
        uid: 'route-invalid',
        title: 'Invalid',
        colorArgb: 0,
        points: [coordinate],
        createdAt,
      }),
    ).toThrow('at least two points')
  })

  it('rejects oversized, declared-entity, and invalid-time events', () => {
    expect(() => parseCotEvent('x'.repeat(MAX_COT_EVENT_BYTES + 1))).toThrow(
      'size limit',
    )
    expect(() =>
      parseCotEvent(
        '<!DOCTYPE event [<!ENTITY callsign "peer">]><event/>',
      ),
    ).toThrow('declarations are not allowed')

    const valid = operationToCot({
      kind: 'marker',
      uid: 'marker-time',
      callsign: 'Marker',
      coordinate,
      createdAt,
    })
    expect(() =>
      parseCotEvent(valid.replace(createdAt, 'not-a-time')),
    ).toThrow('Invalid CoT time')
    expect(() =>
      parseCotEvent(
        valid.replace(
          '2026-07-30T05:05:00.000Z',
          '2026-07-30T04:59:59.000Z',
        ),
      ),
    ).toThrow('Invalid CoT stale time')
  })

  it('rejects coordinates and geometry that cannot be rendered safely', () => {
    const valid = operationToCot({
      kind: 'marker',
      uid: 'marker-coordinate',
      callsign: 'Marker',
      coordinate,
      createdAt,
    })
    expect(() =>
      parseCotEvent(valid.replace('lat="39.7408"', 'lat="91"')),
    ).toThrow('Invalid CoT latitude')
    expect(() =>
      parseCotEvent(valid.replace('lon="-104.9937"', 'lon="-181"')),
    ).toThrow('Invalid CoT longitude')

    const route = operationToCot({
      kind: 'route',
      uid: 'route-large',
      title: 'Large route',
      colorArgb: 0,
      points: Array.from(
        { length: MAX_COT_GEOMETRY_POINTS + 1 },
        (_, index) => ({
          ...coordinate,
          latitude: coordinate.latitude + index / 100_000,
        }),
      ),
      createdAt,
    })
    expect(() => parseCotEvent(route)).toThrow('geometry point limit')
  })
})
