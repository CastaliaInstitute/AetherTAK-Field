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
- `getStatus()`
- `getContacts()`
- `sendCot({ message })`

The plugin must support standard CoT position, contacts, chat, markers, routes,
shapes, emergency events, and attachment mission packages. It must never return
private key bytes, passwords, or raw PKCS#12 content over the Capacitor bridge.

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
