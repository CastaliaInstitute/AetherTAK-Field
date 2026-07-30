# Native plugin contracts

## AetherTakTransport

Swift and Kotlin implementations own all certificate and private-key handling.
On iOS, identities belong in the Keychain with non-exportable access where
possible. On Android, import keys into Android Keystore-backed storage.

Methods exposed to the shared layer:

- `importEnrollmentPackage({ path })`: validate the signed TAK data package,
  import its trust chain and client identity, and return a non-secret profile.
- `connect({ profileId? })`: establish TLS CoT streaming with reconnect and
  certificate validation.
- `disconnect()`
- `removeEnrollment()`: disconnect, remove the active private identity and
  trust anchor from Keychain/Android KeyStore, and clear non-secret profile
  metadata.
- `getStatus()`
- `getBackgroundTrackingStatus()`
- `setBackgroundTracking({ enabled })`: explicitly start or stop native,
  system-visible team PLI updates while the web view is suspended.
- `getContacts()`
- `sendCot({ xml })`
- `fieldMutation({ port, mutation })`
- `fieldChanges({ port, cursor, limit })`
- `fieldUpload({ port, mediaId, uri, contentType, ... })`
- `fieldDownload({ port, mediaId, expectedSha256?, expectedContentType? })`

The plugin supports standard CoT position, contacts, chat, markers, routes,
shapes, and emergency events. Field API calls reuse the same issued identity and
pinned CA; downloaded artifacts are committed to app-private storage only after
content length, type, and SHA-256 validation. It must never return private key
bytes, passwords, or raw PKCS#12 content over the Capacitor bridge.

Background team tracking is opt-in and stops on disconnect, enrollment
replacement, or credential removal. Android uses a location-typed foreground
service with a persistent notification and Stop action; it relies on foreground
location permission and does not request `ACCESS_BACKGROUND_LOCATION`. iOS uses
Core Location with the `location` background mode and displays the system
background-location indicator. The shared foreground watcher is disabled while
the native publisher is active so the same identity does not emit duplicate
PLI.

## AetherDepthScanner

The plugin reports capabilities before presenting a capture UI:

- iOS: ARKit scene depth / LiDAR, confidence maps, point clouds, and mesh export.
- Android: ARCore Depth API, confidence metadata where available, point clouds,
  and model export.

Methods:

- `getCapability()`
- `startScan({ coordinate, mode })`
- `cancelScan()`

Each result includes its provider, UTC timestamp, coordinate and accuracy,
preview/depth file URIs, optional confidence/point-cloud/model files, and
measurements with uncertainty. Unsupported devices return `supported: false`;
they must not crash or show a nonfunctional scan action.

## Interoperability gates

Before beta distribution, verify on physical devices:

1. Enrollment with an AetherTAK data package and certificate renewal.
2. Bidirectional PLI, contacts, GeoChat, markers, routes, shapes, emergency,
   and mission-package attachments with current iTAK and ATAK releases.
3. Offline creation, app termination, recovery, conflict handling, and ordered
   sync after connectivity returns.
4. Photo/video metadata and file integrity across offline sync.
5. LiDAR/Depth accuracy against known dimensions, including confidence and
   unsupported-device fallback.

## In-app physical-device evidence

Open **Team → Device readiness** on each release-candidate installation and run
the readiness check after enrollment and the required field exercises. Share
the generated JSON report into the controlled release-evidence location. The
versioned report records:

- native app version/build, source revision, and physical-versus-virtual device
  state;
- device model, operating-system version, and WebView version;
- sanitized TAK enrollment, connection, contact-count, and background-tracking
  state;
- ARKit LiDAR or ARCore Depth capability and supported artifact types;
- field and TAK queue state, conflicts, sync cursor, and last synchronization;
- ready/partial offline-map counts and downloaded tile totals; and
- media counts, queue state, and photo/video SHA-256 coverage.

The export deliberately excludes private keys, certificates, enrollment
passwords, server addresses, profile/device identifiers, personal device
names, coordinates, chat/event content, observation notes, and media content.
It is a state snapshot, not a substitute for the behavioral evidence matrix:
retain it alongside screenshots/video, peer versions, TAK Server log intervals,
and measured depth results.

For released-client validation, create a durable session under **Team → iTAK /
ATAK test session**. It records every direction separately for PLI, screen-lock
background PLI, GeoChat, markers, routes, open and closed shapes, emergencies,
mission packages, reconnect, and stale removal. Export the session JSON beside
the referenced screenshots and TAK Server log interval. The app stores
references rather than copying potentially sensitive screenshots or logs into
the report.

## Implementation status

The shared CoT codec, offline TAK outbox, durable inbound/outbound activity,
interactive map tools, GeoChat composer, foreground PLI publishing, emergency
confirmation/cancellation, and bidirectional domain/media sync are implemented
and unit tested.
The Swift and Kotlin plugins are registered in their native projects. Both TAK
plugins parse the issued mission package, enforce archive-size and XML safety
limits, import the client identity into Keychain/Android KeyStore, retain only
non-secret profile metadata outside secure storage, pin the issued CA, enforce
TLS 1.2 or newer with server-name verification, stream CoT bidirectionally,
extract live contacts, and stream checksum-verified media into app-private
storage. Enrollment imports validate certificate validity and chain trust,
stage replacement credentials under unique labels, synchronously activate the
new profile, roll staged items back on failure, and retire the previous identity
only after activation succeeds. Disconnect preserves enrollment; explicit
removal destroys it. CI compiles Android on Ubuntu and iOS on a macOS runner.
Both plugins also provide explicit native background PLI sessions using a
15-second publish throttle and 45-second stale window. Android PLI encoding has
native unit coverage; platform suspension, battery-management, permission
revocation, and notification/indicator behavior still require physical-device
evidence.

ARKit LiDAR and ARCore Depth capture/export are implemented with capability
fallbacks. Physical-device accuracy, end-to-end sync, iTAK/ATAK
interoperability, signing, and beta distribution remain open gates.
