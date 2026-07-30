import { describe, expect, it } from 'vitest'
import type { Coordinate } from '../domain/models'
import { operationToCot, parseCotEvent } from './cot'
import type { TakIdentity } from './operations'

const identity: TakIdentity = {
  uid: 'AETHER-FIELD-01',
  callsign: 'Field One',
  team: 'Green',
  role: 'Team Member',
}

const coordinate: Coordinate = {
  latitude: 39.7408,
  longitude: -104.9937,
  altitudeMeters: 1608,
  horizontalAccuracyMeters: 4,
  verticalAccuracyMeters: 7,
  headingDegrees: 82,
}

const createdAt = '2026-07-30T05:00:00.000Z'

const atakPli = `<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="ANDROID-123456" type="a-f-G-U-C"
  how="m-g" time="2026-07-30T05:00:00.000Z"
  start="2026-07-30T05:00:00.000Z" stale="2026-07-30T05:05:00.000Z">
  <point lat="39.7408" lon="-104.9937" hae="1608" ce="4" le="7"/>
  <detail>
    <contact callsign="101" endpoint="*:-1:stcp"/>
    <__group name="Green" role="Team Member"/>
    <status battery="87"/>
    <track course="270.5" speed="2.25"/>
    <takv device="Pixel" platform="ATAK-CIV" os="35" version="5"/>
  </detail>
</event>`

const atakGeoChat = `<event version="2.0"
  uid="GeoChat.ANDROID-123456.AETHER-FIELD-01.message-7"
  type="b-t-f" how="h-g-i-g-o"
  time="2026-07-30T05:01:00.000Z"
  start="2026-07-30T05:01:00.000Z"
  stale="2026-07-31T05:01:00.000Z">
  <point lat="39.7408" lon="-104.9937" hae="1608" ce="4" le="7"/>
  <detail>
    <__chat id="AETHER-FIELD-01" messageId="message-7"
      senderCallsign="ATAK One" chatroom="Field One"
      parent="RootContactGroup" groupOwner="false">
      <chatgrp id="AETHER-FIELD-01"
        uid0="ANDROID-123456" uid1="AETHER-FIELD-01"/>
    </__chat>
    <link uid="ANDROID-123456" type="a-f-G-U-C" relation="p-p"/>
    <remarks source="BAO.F.ATAK.ANDROID-123456"
      to="AETHER-FIELD-01" time="2026-07-30T05:01:00.000Z">Gate &amp; pump checked</remarks>
    <marti><dest callsign="Field One"/></marti>
  </detail>
</event>`

const atakRoute = `<event version="2.0" uid="route-7" type="b-m-r"
  how="h-e" time="2026-07-30T05:02:00.000Z"
  start="2026-07-30T05:02:00.000Z" stale="2026-07-30T05:07:00.000Z">
  <point lat="39.7408" lon="-104.9937" hae="1608" ce="9999999" le="9999999"/>
  <detail>
    <contact callsign="Irrigation walk"/>
    <link_attr color="-16711936" stroke="4" type="Vehicle"
      method="Driving" direction="Infil" routetype="Primary"
      order="Ascending" planningmethod="Infil" prefix="CP"/>
    <link uid="CP1" type="b-m-p-w" relation="c" point="39.7408,-104.9937,1608"/>
    <link uid="CP2" type="b-m-p-w" relation="c" point="39.741,-104.994,1609"/>
  </detail>
</event>`

const peerShape = `<?xml version="1.0"?>
<event version="2.0" uid="shape-9" type="u-d-f" how="h-e"
 time="2026-07-30T05:03:00Z" start="2026-07-30T05:03:00Z"
 stale="2026-07-30T05:08:00Z">
 <point lat="39.7408" lon="-104.9937" hae="1608" ce="9999999" le="9999999"/>
 <detail>
  <contact callsign="Treatment zone"/>
  <strokeColor value="-256"/>
  <strokeWeight value="3"/>
  <shape>
   <polyline closed="true" color="-256" fillColor="855637760">
    <vertex lat="39.7408" lon="-104.9937" hae="1608"/>
    <vertex lat="39.7410" lon="-104.9937" hae="1608"/>
    <vertex lat="39.7410" lon="-104.9940" hae="1608"/>
   </polyline>
  </shape>
 </detail>
</event>`

const atakEmergencyCancel = `<event version="2.0"
 uid="ANDROID-123456-9-1-1" type="b-a-o-can" how="h-g-i-g-o"
 time="2026-07-30T05:04:00.000Z" start="2026-07-30T05:04:00.000Z"
 stale="2026-07-30T05:04:10.000Z">
 <point lat="39.7408" lon="-104.9937" hae="1608" ce="4" le="7"/>
 <detail><emergency cancel="true">ATAK One</emergency></detail>
</event>`

describe('ATAK and iTAK CoT interoperability fixtures', () => {
  it('accepts ATAK PLI extensions and preserves numeric callsigns', () => {
    expect(parseCotEvent(atakPli)).toMatchObject({
      uid: 'ANDROID-123456',
      kind: 'position',
      callsign: '101',
      coordinate: {
        latitude: 39.7408,
        longitude: -104.9937,
        headingDegrees: 270.5,
      },
    })
  })

  it('accepts ATAK GeoChat and ignores server routing extensions', () => {
    expect(parseCotEvent(atakGeoChat)).toMatchObject({
      kind: 'chat',
      callsign: 'ATAK One',
      remarks: 'Gate & pump checked',
    })
  })

  it('accepts ATAK route link_attr and waypoint links', () => {
    const parsed = parseCotEvent(atakRoute)
    expect(parsed).toMatchObject({
      kind: 'route',
      callsign: 'Irrigation walk',
    })
    expect(parsed.points).toHaveLength(2)
    expect(parsed.points[1]).toMatchObject({
      latitude: 39.741,
      longitude: -104.994,
      altitudeMeters: 1609,
    })
  })

  it('accepts peer shape serialization with extra style details', () => {
    const parsed = parseCotEvent(peerShape)
    expect(parsed.kind).toBe('shape')
    expect(parsed.callsign).toBe('Treatment zone')
    expect(parsed.points).toHaveLength(3)
  })

  it('recognizes ATAK emergency cancellation semantics', () => {
    expect(parseCotEvent(atakEmergencyCancel)).toMatchObject({
      kind: 'emergency',
      callsign: 'ATAK One',
      emergencyType: 'Cancel',
    })
  })

  it('emits ATAK-compatible GeoChat addressing and lifetime', () => {
    const xml = operationToCot({
      kind: 'chat',
      uid: 'GeoChat.AETHER-FIELD-01.ANDROID-123456.message-1',
      sender: identity,
      recipientUid: 'ANDROID-123456',
      conversationId: 'ANDROID-123456',
      conversationName: 'ATAK One',
      message: 'Water line is clear.',
      createdAt,
    })

    expect(xml).toContain(
      'messageId="GeoChat.AETHER-FIELD-01.ANDROID-123456.message-1"',
    )
    expect(xml).toContain('source="BAO.F.ATAK.AETHER-FIELD-01"')
    expect(xml).toContain('stale="2026-07-31T05:00:00.000Z"')
  })

  it('emits ATAK route, shape, and emergency-cancel details', () => {
    const route = operationToCot({
      kind: 'route',
      uid: 'route-1',
      title: 'Irrigation walk',
      colorArgb: -16711936,
      points: [coordinate, { ...coordinate, latitude: 39.741 }],
      createdAt,
    })
    expect(route).toContain(
      '<link_attr color="-16711936" stroke="4" type="Vehicle"',
    )
    expect(route).not.toContain('<route ')

    const shape = operationToCot({
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
    })
    expect(shape).toContain(
      '<polyline closed="true" color="-256" fillColor="0">',
    )

    const cancel = operationToCot({
      kind: 'emergency',
      uid: 'AETHER-FIELD-01-9-1-1',
      identity,
      coordinate,
      emergencyType: 'Cancel',
      createdAt,
    })
    expect(cancel).toContain('type="b-a-o-can"')
    expect(cancel).toContain(
      '<emergency cancel="true">Field One</emergency>',
    )
    expect(parseCotEvent(cancel).emergencyType).toBe('Cancel')
  })
})
