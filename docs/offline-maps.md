# Offline maps

AetherTAK Field stores named map-region manifests in IndexedDB and raster tiles
in browser/Capacitor Cache Storage. The region planner uses standard Web
Mercator slippy-map coordinates, records exact tile counts before download,
limits unexpectedly large jobs, supports cancellation, and records partial
downloads for recovery.

Downloads preserve a 100 MiB storage reserve whenever the platform provides a
quota estimate. The downloader checks again as uncached tiles are added, stops
on the first browser/WebView quota-exhaustion error, records the region as
partial or failed, and keeps already cached tiles available for a later resume.
An unavailable quota estimate does not fabricate capacity; the cache write
still fails boundedly if the platform reports storage exhaustion.

Production map regions must use a tile service or packaged data for which
Castalia Institute has explicit offline-download rights. The OpenStreetMap
standard tile service used by the development preview is not an offline bulk
download source and must not be configured for region downloads.

Each configured source requires:

- Stable source identifier.
- HTTPS URL template containing `{z}`, `{x}`, and `{y}`.
- Attribution and licensing information.
- Explicit zoom and geographic bounds.
- A documented tile-count ceiling appropriate to the device.

Copy `.env.example` to a local environment file and provide the licensed source
configuration. Setting `VITE_MAP_TILE_ALLOW_OFFLINE=true` enables the region
download action. The live MapLibre map uses the `aether-raster://` protocol,
which checks the region cache before the network, so cached tiles render in
airplane mode without a separate code path.

Before mobile beta, verify airplane-mode rendering after process termination
and test cache eviction plus low-storage behavior on both platforms.
