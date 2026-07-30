# AetherTAK Field

An offline-first field operations client for AetherTAK, agriculture, and
ecological monitoring. The shared React application runs as a PWA-capable web
client and inside Capacitor shells for iOS and Android.

## Current foundation

- MapLibre operational map with crop and ecological polygons, labeled LoRaWAN
  sensor values, offline evidence, anchored alerts, read-only Al insights, safe
  tap details, and TAK contacts.
- Property/season crop records and ecological site status.
- Persisted property, season, crop-field, ecological-site, observation, alert,
  and read-only Al insight records.
- ChirpStack v4 uplink normalization with LoRaWAN radio metadata.
- Publisher-managed ChirpStack readings and read-only Al insights delivered
  through the ordered field change feed and refreshed every 30 seconds while
  connected, without granting mobile clients mutation rights.
- Offline map-region planning, Cache Storage downloads, and a cache-first
  MapLibre raster protocol for authorized tile sources.
- Structured field/ecology observation capture with category, title, notes,
  geotagged native photo/video, selectable depth output, app-private media,
  streaming SHA-256 integrity for photo, video, depth, confidence, point-cloud,
  and model evidence, and an atomic sync outbox.
- Bidirectional field-record and media synchronization with durable revisions,
  conflict preservation, paginated cursors, mTLS uploads/downloads, checksum
  verification, and atomic app-private file hydration.
- Native plugin contracts for certificate-backed TAK transport and
  capability-detected ARKit LiDAR / ARCore Depth.
- CoT 2.0 encoding and parsing for PLI, GeoChat, markers, routes, shapes, and
  emergency events, plus server-hosted mission-package requests and receipts,
  backed by a durable offline TAK event outbox and activity history.
- Live native contacts, foreground PLI publishing, addressed GeoChat,
  tap-to-compose markers/routes/open lines/closed areas, rendered TAK geometry, and explicitly
  confirmed emergency signaling with cancellation.
- Recipient-targeted TAK mission-package ZIP exchange with app-private offline
  staging, authenticated Marti upload/download, explicit inbound approval,
  byte-count and SHA-256 verification, receipts, and native open/share.
- Opt-in native background PLI with a visible iOS location indicator or Android
  location foreground-service notification and an in-app stop control.
- Read-only Al field insight surface.
- Versioned, privacy-safe physical-device readiness reports with native
  app/build, hardware, TAK, depth, sync, offline-map, and media-integrity
  evidence export through the platform share sheet.
- Durable per-device release-validation sessions for enrollment renewal,
  offline recovery, camera/video integrity, depth accuracy and artifacts,
  platform fallback, screen-lock tracking, permission loss, airplane mode, and
  low-storage behavior.
- Durable per-device iTAK/ATAK physical-test sessions with bidirectional
  capability results, exact build/source traceability, controlled screen/log
  references, and privacy-bounded JSON export.
- A fail-closed private evidence-bundle verifier that binds beta distribution
  to the exact version, build, commit, physical platform/depth coverage, and
  complete released-client interoperability results.

The browser provides a safe preview. Certificate enrollment, CoT transport, and
depth capture are intentionally native-only so private key material does not
cross the JavaScript bridge.

The checked-in Swift and Kotlin native bridge classes provide real device
capability detection and guided depth capture. Swift and Kotlin TAK bridges import the issued
data-package format directly, keep PKCS#12 passphrases native-only, store client
identities in Keychain/Android KeyStore, pin the issued CA, require TLS 1.2 or
newer, verify the server identity, stream CoT bidirectionally, and maintain live
contacts. Native field API clients reuse that identity for verified streaming
media transfers. ARKit exports depth, confidence, point clouds, measurements,
and supported meshes; ARCore exports depth, confidence, point clouds,
measurements, and bounded sampled depth-surface OBJ models.

## Development

Requires Node.js 22 or newer.

```bash
npm ci
npm run test:run
npm run build
```

Synchronize the web build into both native projects:

```bash
npm run cap:sync
```

## iOS handoff

Clone the repository on a Mac with Xcode installed, then:

```bash
npm ci
npm run cap:sync
npm run ios
```

Select the `App` target, choose the Castalia Institute signing team, and run on
a physical iPhone or iPad. LiDAR functionality must be tested on a supported
device; the UI falls back cleanly when ARKit scene depth is unavailable.

## Android handoff

Install Android Studio and JDK 21, then:

```bash
npm ci
npm run cap:sync
npm run android
```

The native implementations provide the `AetherTakTransport`,
`AetherDepthScanner`, and `AetherMediaIntegrity` Capacitor plugins described in
[docs/native-plugins.md](docs/native-plugins.md).

Offline map source requirements and remaining runtime integration gates are in
[docs/offline-maps.md](docs/offline-maps.md).

Secret-gated TestFlight and Google Play internal-testing setup is documented in
[docs/beta-distribution.md](docs/beta-distribution.md).

The physical-device execution matrix and controlled-evidence rules are in
[docs/physical-release-validation.md](docs/physical-release-validation.md).

## Server endpoints

The Pi deployment currently advertises the `192.168.86.0/24` subnet through
Tailscale. Enrolled clients use the server address inside their TAK data
package; ChirpStack is available at `http://192.168.86.69:8080` on the LAN or
advertised subnet.

Never commit enrollment packages, PKCS#12 files, passwords, private keys, or
ChirpStack API tokens.
