# TAK interoperability

## Automated protocol gate

`src/tak/cot.interop.test.ts` exercises the shared CoT codec with peer payload
shapes used by TAK clients:

- ATAK PLI with contact, group, status, track, and TAK-version extensions
- ATAK GeoChat addressing, message identifiers, remarks, and server-routing
  extensions
- ATAK routes using `link_attr` metadata and waypoint `link` elements
- closed shapes with polyline styling and vertices
- ATAK emergency initiation and `cancel="true"` cancellation semantics
- XML declarations, formatting whitespace, unknown detail extensions, and
  numeric-looking callsigns

The outbound assertions follow the public ATAK-CIV implementation:

- `GeoChatService` for `b-t-f` GeoChat details
- `Route.toCot()` for `b-m-r` route metadata
- `EmergencyManager` for emergency initiation and cancellation
- `ShapeDetailHandler` for shape/polyline details

Reference source:
<https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV>

These tests are a deterministic protocol gate, not a substitute for testing
released iTAK and ATAK binaries. Peer payloads are representative compatibility
probes and do not claim to be captured traffic from a particular release.

## Physical-device gate

Before beta distribution, record a bidirectional test between AetherTAK Field,
current iTAK, and current ATAK for each row:

| Capability | Field → iTAK | iTAK → Field | Field → ATAK | ATAK → Field |
| --- | --- | --- | --- | --- |
| PLI and contact lifecycle | Pending | Pending | Pending | Pending |
| Direct GeoChat | Pending | Pending | Pending | Pending |
| Marker | Pending | Pending | Pending | Pending |
| Route | Pending | Pending | Pending | Pending |
| Closed and open shape | Pending | Pending | Pending | Pending |
| Emergency initiation | Pending | Pending | Pending | Pending |
| Emergency cancellation | Pending | Pending | Pending | Pending |
| Mission-package attachment | Pending | Pending | Pending | Pending |

For every test, retain the client versions, device/OS versions, server version,
UTC timestamp, sender and recipient callsigns, screen evidence, and the matching
TAK Server log interval. Test reconnect and stale-item removal after the live
exchange.
