# AetherTAK Field

An offline-first field operations client for AetherTAK, agriculture, and
ecological monitoring. The shared React application runs as a PWA-capable web
client and inside Capacitor shells for iOS and Android.

## Current foundation

- MapLibre field map with crop polygons, LoRaWAN sensor points, and TAK contacts.
- Property/season crop records and ecological site status.
- Persisted property, season, crop-field, ecological-site, observation, alert,
  and read-only Al insight records.
- ChirpStack v4 uplink normalization with LoRaWAN radio metadata.
- Offline map-region planning, Cache Storage downloads, and a cache-first
  MapLibre raster protocol for authorized tile sources.
- Durable geotagged photo and video observations using native Camera,
  Geolocation, Filesystem, SHA-256 photo integrity, and an atomic sync outbox.
- IndexedDB field records and durable mutation outbox for offline sync.
- Native plugin contracts for certificate-backed TAK transport and
  capability-detected ARKit LiDAR / ARCore Depth.
- CoT 2.0 encoding and parsing for PLI, GeoChat, markers, routes, shapes, and
  emergency events, backed by a durable offline TAK event outbox.
- Read-only Al field insight surface.

The browser provides a safe preview. Certificate enrollment, CoT transport, and
depth capture are intentionally native-only so private key material does not
cross the JavaScript bridge.

The checked-in Swift and Java native bridge classes currently provide real
device capability detection and explicit unavailable/not-implemented results.
Certificate import, streaming TLS transport, and depth-capture sessions are the
next native implementation gate; the app does not pretend these operations
succeeded in this foundation build.

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

The production native implementations must provide the
`AetherTakTransport` and `AetherDepthScanner` Capacitor plugins described in
[docs/native-plugins.md](docs/native-plugins.md).

Offline map source requirements and remaining runtime integration gates are in
[docs/offline-maps.md](docs/offline-maps.md).

## Server endpoints

The Pi deployment currently advertises the `192.168.86.0/24` subnet through
Tailscale. Enrolled clients use the server address inside their TAK data
package; ChirpStack is available at `http://192.168.86.69:8080` on the LAN or
advertised subnet.

Never commit enrollment packages, PKCS#12 files, passwords, private keys, or
ChirpStack API tokens.
