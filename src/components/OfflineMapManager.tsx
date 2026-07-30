import { useEffect, useMemo, useRef, useState } from 'react'
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
  planRegionTiles,
  type RegionDownloadProgress,
} from '../maps/offlineRegions'
import type { RasterTileSource } from '../maps/tileSource'

interface OfflineMapManagerProps {
  properties: Property[]
  regions: OfflineMapRegion[]
  source: RasterTileSource
  onNotice: (message: string) => void
}

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

export function OfflineMapManager({
  properties,
  regions,
  source,
  onNotice,
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
  const controller = useRef<AbortController | null>(null)
  const property =
    properties.find((item) => item.id === propertyId) ?? properties[0]
  const validZoomRange =
    Number.isInteger(minZoom) &&
    Number.isInteger(maxZoom) &&
    minZoom >= 0 &&
    maxZoom <= 22 &&
    minZoom <= maxZoom

  const plannedTiles = useMemo(() => {
    if (!property || !validZoomRange) return 0
    return planRegionTiles(
      propertyBounds(property),
      minZoom,
      maxZoom,
    ).length
  }, [maxZoom, minZoom, property, validZoomRange])

  useEffect(() => {
    let disposed = false
    void navigator.storage?.estimate().then((estimate) => {
      if (!disposed) setStorage(estimate)
    })
    return () => {
      disposed = true
    }
  }, [regions])

  async function download(region: OfflineMapRegion) {
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
      tileUrlTemplate: source.urlTemplate,
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
            disabled={!property || activeId !== null || !validZoomRange}
            onClick={() => void createAndDownload()}
          >
            <Download size={15} />
            Download {plannedTiles.toLocaleString()} tiles
          </button>
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
              <small className={region.status}>{region.status}</small>
            </div>
            <div className="offline-region-actions">
              {region.status !== 'ready' && activeId !== region.id && (
                <button
                  type="button"
                  disabled={activeId !== null}
                  aria-label={`Resume ${region.name}`}
                  onClick={() => void download(region)}
                >
                  <Play size={15} />
                </button>
              )}
              <button
                type="button"
                disabled={activeId !== null}
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
        <small>{source.attribution}</small>
      </footer>
    </section>
  )
}
