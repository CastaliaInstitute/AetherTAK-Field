import { describe, expect, it } from 'vitest'
import type { Coordinate } from '../domain/models'
import { operationToCot, parseCotEvent } from './cot'
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
})
