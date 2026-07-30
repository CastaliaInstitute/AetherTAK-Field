import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Download,
  HardDrive,
  MapPinned,
  Pause,
  Play,
  Trash2,
} from 'lucide-react'
import type {
  OfflineMapRegion,
  Property,
} from '../domain/models'
import {
  createOfflineMapRegion,
  deleteOfflineMapRegion,
  downloadOfflineMapRegion,
  offlineMapStorageReserveBytes,
  planRegionTiles,
  reconcileOfflineMapRegions,
  type RegionDownloadProgress,
} from '../maps/offlineRegions'
import type { RasterTileSource } from '../maps/tileSource'

interface OfflineMapManagerProps {
  properties: Property[]
  regions: OfflineMapRegion[]
  source: RasterTileSource
  onNotice: (message: string) => void
  estimateStorage?: () => Promise<StorageEstimate>
}

const estimateBrowserStorage = () =>
  navigator.storage?.estimate() ?? Promise.resolve({})

function propertyBounds(property: Property) {
  const longitudes = property.boundary.map(([longitude]) => longitude)
  const latitudes = property.boundary.map(([, latitude]) => latitude)
  return {
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  }
}

function bytes(value: number | undefined) {
  if (value === undefined) return 'unknown'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function inventoryFingerprint(regions: OfflineMapRegion[]) {
  return JSON.stringify(
    [...regions]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((region) => ({
        id: region.id,
        tileSourceId: region.tileSourceId,
        bounds: region.bounds,
        minZoom: region.minZoom,
        maxZoom: region.maxZoom,
      })),
  )
}

export function OfflineMapManager({
  properties,
  regions,
  source,
  onNotice,
  estimateStorage = estimateBrowserStorage,
}: OfflineMapManagerProps) {
  const [propertyId, setPropertyId] = useState('')
  const [minZoom, setMinZoom] = useState(12)
  const [maxZoom, setMaxZoom] = useState(17)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeRegion, setActiveRegion] =
    useState<OfflineMapRegion | null>(null)
  const [progress, setProgress] =
    useState<RegionDownloadProgress | null>(null)
  const [storage, setStorage] = useState<StorageEstimate | null>(null)
  const [inventoryBusy, setInventoryBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const reconciledFingerprint = useRef<string | null>(null)
  const inventoryRunning = useRef(false)
  const property =
    properties.find((item) => item.id === propertyId) ?? properties[0]
  const validZoomRange =
    Number.isInteger(minZoom) &&
    Number.isInteger(maxZoom) &&
    minZoom >= 0 &&
    maxZoom <= 22 &&
    minZoom <= maxZoom
  const availableStorage =
    storage?.usage !== undefined && storage.quota !== undefined
      ? Math.max(0, storage.quota - storage.usage)
      : null
  const storageTooLow =
    availableStorage !== null &&
    availableStorage < offlineMapStorageReserveBytes

  const plannedTiles = useMemo(() => {
    if (!property || !validZoomRange) return 0
    return planRegionTiles(
      propertyBounds(property),
      minZoom,
      maxZoom,
    ).length
  }, [maxZoom, minZoom, property, validZoomRange])
  const regionFingerprint = useMemo(
    () => inventoryFingerprint(regions),
    [regions],
  )
  const inventoryPending =
    inventoryBusy ||
    (
      regions.length > 0 &&
      reconciledFingerprint.current !== regionFingerprint
    )

  const reconcileInventory = useCallback(async () => {
    if (
      activeId !== null ||
      regions.length === 0 ||
      inventoryRunning.current
    ) return
    inventoryRunning.current = true
    setInventoryBusy(true)
    try {
      const result = await reconcileOfflineMapRegions(regions, source)
      if (result.changedRegions === 0) return
      onNotice(
        result.evictedTiles > 0
          ? `${result.evictedTiles} offline map tile${result.evictedTiles === 1 ? ' was' : 's were'} evicted by the device. Affected regions are ready to resume.`
          : `Recovered the cached tile inventory for ${result.changedRegions} offline map region${result.changedRegions === 1 ? '' : 's'}.`,
      )
    } finally {
      inventoryRunning.current = false
      setInventoryBusy(false)
    }
  }, [activeId, onNotice, regions, source])

  useEffect(() => {
    let disposed = false
    void estimateStorage().then((estimate) => {
      if (!disposed) setStorage(estimate)
    }).catch(() => {
      if (!disposed) setStorage(null)
    })
    return () => {
      disposed = true
    }
  }, [estimateStorage, regions])

  useEffect(() => {
    if (
      reconciledFingerprint.current === regionFingerprint ||
      activeId !== null
    ) return
    reconciledFingerprint.current = regionFingerprint
    let disposed = false
    void reconcileInventory().catch(() => {
      if (!disposed) {
        onNotice('Offline map cache inventory could not be verified.')
      }
    })
    return () => {
      disposed = true
    }
  }, [
    activeId,
    onNotice,
    reconcileInventory,
    regionFingerprint,
  ])

  useEffect(() => {
    const reconcileWhenVisible = () => {
      if (
        document.visibilityState !== 'visible' ||
        activeId !== null
      ) return
      void reconcileInventory().catch(() => {
        onNotice('Offline map cache inventory could not be verified.')
      })
    }
    document.addEventListener('visibilitychange', reconcileWhenVisible)
    return () =>
      document.removeEventListener('visibilitychange', reconcileWhenVisible)
  }, [activeId, onNotice, reconcileInventory])

  async function download(region: OfflineMapRegion) {
    if (region.tileSourceId !== source.id) {
      onNotice(
        `${region.name} belongs to map source ${region.tileSourceId}, which is not configured in this build.`,
      )
      return
    }
    const abort = new AbortController()
    controller.current = abort
    setActiveId(region.id)
    setActiveRegion(region)
    setProgress({
      completed: region.downloadedTiles,
      total: region.tileCount,
      failed: 0,
    })
    try {
      const downloaded = await downloadOfflineMapRegion(region, {
        tileUrlTemplate: source.urlTemplate,
        signal: abort.signal,
        maxTiles: 5_000,
        onProgress: setProgress,
      })
      onNotice(
        abort.signal.aborted
          ? `${downloaded.name} paused at ${downloaded.downloadedTiles}/${downloaded.tileCount} tiles.`
          : `${downloaded.name} is available offline (${downloaded.downloadedTiles}/${downloaded.tileCount} tiles).`,
      )
    } catch (cause) {
      onNotice(
        cause instanceof Error
          ? cause.message
          : 'Offline map download failed.',
      )
    } finally {
      controller.current = null
      setActiveId(null)
      setActiveRegion(null)
      setProgress(null)
    }
  }

  async function createAndDownload() {
    if (!property || !validZoomRange) return
    const region = createOfflineMapRegion({
      name: property.name,
      tileSourceId: source.id,
      bounds: propertyBounds(property),
      minZoom,
      maxZoom,
    })
    if (region.tileCount > 5_000) {
      onNotice(
        `${region.tileCount} tiles exceeds the 5,000-tile mobile safety limit.`,
      )
      return
    }
    await download(region)
  }

  async function remove(region: OfflineMapRegion) {
    if (
      !window.confirm(
        `Remove the offline map “${region.name}” from this device?`,
      )
    ) return
    try {
      await deleteOfflineMapRegion(region)
      onNotice(`Removed offline map ${region.name}.`)
    } catch (cause) {
      onNotice(
        cause instanceof Error
          ? cause.message
          : 'Offline map removal failed.',
      )
    }
  }

  const active =
    regions.find((region) => region.id === activeId) ?? activeRegion

  return (
    <section className="offline-map-manager" aria-labelledby="offline-map-title">
      <header>
        <div>
          <MapPinned size={18} />
          <div>
            <p className="eyebrow">OFFLINE MAPS</p>
            <h2 id="offline-map-title">Field basemaps</h2>
          </div>
        </div>
        <span className={source.allowOfflineDownload ? 'licensed' : 'preview'}>
          {source.allowOfflineDownload ? 'Download enabled' : 'Online preview'}
        </span>
      </header>

      {!source.allowOfflineDownload ? (
        <p className="offline-map-policy">
          This preview source does not permit bulk downloads. Configure an
          authorized tile source to create offline regions.
        </p>
      ) : (
        <div className="offline-map-planner">
          <label>
            Property
            <select
              aria-label="Offline map property"
              value={property?.id ?? ''}
              onChange={(event) => setPropertyId(event.currentTarget.value)}
            >
              {properties.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Min zoom
            <input
              aria-label="Minimum offline zoom"
              type="number"
              min={0}
              max={22}
              value={minZoom}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber
                if (Number.isInteger(value)) setMinZoom(value)
              }}
            />
          </label>
          <label>
            Max zoom
            <input
              aria-label="Maximum offline zoom"
              type="number"
              min={0}
              max={22}
              value={maxZoom}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber
                if (Number.isInteger(value)) setMaxZoom(value)
              }}
            />
          </label>
          <button
            className="offline-download-action"
            type="button"
            disabled={
              !property ||
              activeId !== null ||
              !validZoomRange ||
              storageTooLow
            }
            onClick={() => void createAndDownload()}
          >
            <Download size={15} />
            Download {plannedTiles.toLocaleString()} tiles
          </button>
          {storageTooLow && (
            <p className="offline-map-storage-warning" role="alert">
              Free device storage before downloading. AetherTAK Field keeps
              at least {bytes(offlineMapStorageReserveBytes)} available.
            </p>
          )}
        </div>
      )}

      {active && progress && (
        <div className="offline-map-progress" role="status">
          <div>
            <strong>{active.name}</strong>
            <span>
              {progress.completed}/{progress.total}
              {progress.failed ? ` · ${progress.failed} failed` : ''}
            </span>
          </div>
          <progress value={progress.completed} max={progress.total} />
          <button type="button" onClick={() => controller.current?.abort()}>
            <Pause size={14} /> Pause
          </button>
        </div>
      )}

      <div className="offline-region-list">
        {inventoryPending && (
          <p className="offline-map-empty" role="status">
            Verifying cached map tiles…
          </p>
        )}
        {regions.length === 0 && (
          <p className="offline-map-empty">No offline regions on this device.</p>
        )}
        {regions.map((region) => (
          <article key={region.id}>
            <div className="offline-region-icon"><MapPinned size={17} /></div>
            <div>
              <strong>{region.name}</strong>
              <span>
                z{region.minZoom}–{region.maxZoom} · {region.downloadedTiles}/
                {region.tileCount} tiles
              </span>
              <small className={region.status}>
                {region.status}
                {region.tileSourceId === source.id
                  ? ''
                  : ' · source unavailable'}
              </small>
            </div>
            <div className="offline-region-actions">
              {region.status !== 'ready' && activeId !== region.id && (
                <button
                  type="button"
                  disabled={
                    activeId !== null ||
                    inventoryPending ||
                    storageTooLow ||
                    region.tileSourceId !== source.id
                  }
                  aria-label={`Resume ${region.name}`}
                  onClick={() => void download(region)}
                >
                  <Play size={15} />
                </button>
              )}
              <button
                type="button"
                disabled={activeId !== null || inventoryPending}
                aria-label={`Delete ${region.name}`}
                onClick={() => void remove(region)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <footer>
        <HardDrive size={14} />
        <span>
          {storage
            ? `${bytes(storage.usage)} used · ${bytes(storage.quota)} quota`
            : 'Storage estimate unavailable'}
        </span>
        <span>
          {bytes(offlineMapStorageReserveBytes)} free-space reserve
        </span>
        <small>{source.attribution}</small>
      </footer>
    </section>
  )
}
