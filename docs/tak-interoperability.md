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
- recipient-targeted `b-f-t-r` mission-package requests with `fileshare`,
  `ackrequest`, and Marti destination details
- `b-f-t-a` mission-package success/failure receipts that reconcile against the
  durable outbound activity
- XML declarations, formatting whitespace, unknown detail extensions, and
  numeric-looking callsigns

Before an inbound event reaches durable activity or the operational map, the
shared boundary limits it to 256 KiB and 100 geometry points, rejects document
type/entity declarations, requires bounded UID/type fields and parseable
`time`/`stale` values, rejects stale times before event times, and validates
latitude/longitude ranges. Mission-package metadata becomes actionable only
when its digest, byte count, and bounded identifiers are valid. Native contact
snapshots are independently schema-filtered so a malformed PLI cannot poison
MapLibre state. Built-in XML entities remain enabled because interoperable
GeoChat text requires them.

The native Swift and Kotlin contact paths additionally exercise double- and
single-quoted attributes, predefined and numeric XML entities, exact element
matching, malformed/custom entity rejection, and bounded input handling.

The outbound assertions follow the public ATAK-CIV implementation:

- `GeoChatService` for `b-t-f` GeoChat details
- `Route.toCot()` for `b-m-r` route metadata
- `EmergencyManager` for emergency initiation and cancellation
- `ShapeDetailHandler` for shape/polyline details
- CommonCommo mission-package rules and `fileshare.xsd` for the server-hosted
  transfer and receipt lifecycle

Reference source:
<https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV>

These tests are a deterministic protocol gate, not a substitute for testing
released iTAK and ATAK binaries. Peer payloads are representative compatibility
probes and do not claim to be captured traffic from a particular release.

## Physical-device gate

Before beta distribution, record a bidirectional test between AetherTAK Field,
current iTAK, and current ATAK for each row:

Use **Team → iTAK / ATAK test session** on the physical AetherTAK Field device.
Create a separate session for each peer device and released-client version. The
session persists locally while testing, records Field → peer and peer → Field
results independently, and exports versioned JSON through the platform share
sheet. Repeat the iTAK and ATAK matrices on every AetherTAK Field platform
included in the beta (iOS, Android, or both). A `blocked` or `fail` result is
useful evidence but does not satisfy the beta gate.

| Capability | Field → iTAK | iTAK → Field | Field → ATAK | ATAK → Field |
| --- | --- | --- | --- | --- |
| PLI and contact lifecycle | Pending | Pending | Pending | Pending |
| Background PLI with screen locked | Pending | Pending | Pending | Pending |
| Direct GeoChat | Pending | Pending | Pending | Pending |
| Marker | Pending | Pending | Pending | Pending |
| Route | Pending | Pending | Pending | Pending |
| Open shape | Pending | Pending | Pending | Pending |
| Closed shape | Pending | Pending | Pending | Pending |
| Emergency initiation | Pending | Pending | Pending | Pending |
| Emergency cancellation | Pending | Pending | Pending | Pending |
| Mission-package attachment | Pending | Pending | Pending | Pending |
| Reconnect after network loss | Pending | Pending | Pending | Pending |
| Stale-item removal | Pending | Pending | Pending | Pending |

For every test, retain the client versions, device/OS versions, server version,
UTC timestamp, sender and recipient callsigns, screen evidence, and the matching
TAK Server log interval. Store screenshots/video and server logs separately in
the controlled evidence location; enter only their references in the app. The
JSON deliberately excludes server addresses, coordinates, message content, and
binary evidence. Exported metadata does not replace the referenced behavioral
evidence.
