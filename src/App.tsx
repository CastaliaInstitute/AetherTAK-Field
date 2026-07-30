import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ChevronRight,
  Download,
  Leaf,
  Map,
  MessageCircle,
  Radio,
  ScanLine,
  Sprout,
  Users,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { FieldMap } from './components/FieldMap'
import { demoSnapshot } from './domain/seed'
import type { DepthCapability, TakConnectionState } from './domain/models'
import {
  captureObservationPhoto,
  captureObservationVideo,
} from './media/observationCapture'
import { depthScanner } from './platform/depth'
import { takTransport } from './platform/tak'
import {
  createOfflineMapRegion,
  downloadOfflineMapRegion,
} from './maps/offlineRegions'
import { activeRasterSource } from './maps/tileSource'
import { importTakDataPackage } from './tak/enrollmentImport'
import './App.css'

type Tab = 'map' | 'fields' | 'capture' | 'team'

const initialDepth: DepthCapability = {
  supported: false,
  provider: 'none',
  supportsPointCloud: false,
  supportsMesh: false,
  supportsConfidence: false,
  reason: 'Checking device…',
}

function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  )
  return minutes < 1 ? 'now' : `${minutes}m ago`
}

export default function App() {
  const [tab, setTab] = useState<Tab>('map')
  const [connection, setConnection] =
    useState<TakConnectionState>('disconnected')
  const [depth, setDepth] = useState<DepthCapability>(initialDepth)
  const [notice, setNotice] = useState<string | null>(null)
  const [offlineMapState, setOfflineMapState] = useState<
    'idle' | 'downloading' | 'ready'
  >('idle')
  const enrollmentInput = useRef<HTMLInputElement>(null)
  const {
    properties,
    seasons,
    fields,
    ecologicalSites,
    readings,
    alerts,
    insights,
    contacts,
  } = demoSnapshot

  useEffect(() => {
    void takTransport.status().then((status) => setConnection(status.state))
    void depthScanner.capability().then(setDepth)
  }, [])

  const averageHealth = useMemo(() => {
    const scored = fields.flatMap((field) =>
      field.healthScore === null ? [] : [field.healthScore],
    )
    return Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
  }, [fields])

  async function takePhoto() {
    setNotice('Opening camera and acquiring a precise location…')
    try {
      const capture = await captureObservationPhoto({
        fieldId: fields[0]?.id ?? null,
        siteId: null,
        category: 'crop',
        title: 'Field photo',
        notes: 'Captured in AetherTAK Field.',
      })
      setNotice(
        `Observation queued at ${capture.observation.coordinate.latitude.toFixed(5)}, ${capture.observation.coordinate.longitude.toFixed(5)}.`,
      )
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Camera capture was cancelled.',
      )
    }
  }

  async function recordVideo() {
    setNotice('Opening video camera and acquiring a precise location…')
    try {
      const capture = await captureObservationVideo({
        fieldId: fields[0]?.id ?? null,
        siteId: null,
        category: 'crop',
        title: 'Field video',
        notes: 'Recorded in AetherTAK Field.',
      })
      setNotice(
        `Video observation queued at ${capture.observation.coordinate.latitude.toFixed(5)}, ${capture.observation.coordinate.longitude.toFixed(5)}.`,
      )
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Video recording was cancelled.',
      )
    }
  }

  async function cachePropertyMap() {
    if (!activeRasterSource.allowOfflineDownload) {
      setNotice(
        'Offline download is disabled for the preview basemap. Configure an authorized tile source first.',
      )
      return
    }
    const boundary = properties[0]?.boundary
    if (!boundary) return
    const longitudes = boundary.map(([longitude]) => longitude)
    const latitudes = boundary.map(([, latitude]) => latitude)
    const region = createOfflineMapRegion({
      name: properties[0].name,
      tileSourceId: activeRasterSource.id,
      tileUrlTemplate: activeRasterSource.urlTemplate,
      bounds: {
        west: Math.min(...longitudes),
        south: Math.min(...latitudes),
        east: Math.max(...longitudes),
        north: Math.max(...latitudes),
      },
      minZoom: 12,
      maxZoom: 17,
    })
    setOfflineMapState('downloading')
    setNotice(`Downloading ${region.tileCount} authorized map tiles…`)
    try {
      const downloaded = await downloadOfflineMapRegion(region, {
        maxTiles: 5_000,
      })
      setOfflineMapState(downloaded.status === 'ready' ? 'ready' : 'idle')
      setNotice(
        `${downloaded.downloadedTiles}/${downloaded.tileCount} map tiles are available offline.`,
      )
    } catch (error) {
      setOfflineMapState('idle')
      setNotice(
        error instanceof Error ? error.message : 'Offline map download failed.',
      )
    }
  }

  async function enrollTak(file: File | undefined) {
    if (!file) return
    setNotice('Validating and importing the TAK certificate package…')
    try {
      const profile = await importTakDataPackage(file)
      setNotice(`Enrolled ${profile.callsign} with ${profile.name}.`)
      const status = await takTransport.connect(profile.id)
      setConnection(status.state)
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'TAK enrollment failed.',
      )
    } finally {
      if (enrollmentInput.current) enrollmentInput.current.value = ''
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CASTALIA INSTITUTE</p>
          <h1>AetherTAK <span>Field</span></h1>
        </div>
        <button
          className={`connection ${connection}`}
          type="button"
          aria-label={`TAK status: ${connection}`}
          onClick={() => void takTransport.connect().then((value) => setConnection(value.state))}
        >
          {connection === 'connected' ? <Wifi size={17} /> : <WifiOff size={17} />}
          <span>{connection === 'connected' ? 'TAK live' : 'TAK preview'}</span>
        </button>
      </header>

      {tab === 'map' && (
        <>
          <section className="status-strip" aria-label="Field status">
            <div><strong>{fields.length + ecologicalSites.length}</strong><span>Active sites</span></div>
            <div><strong>{readings.length}</strong><span>Sensors live</span></div>
            <div><strong>{averageHealth}%</strong><span>Field health</span></div>
          </section>

          <button
            className={`offline-map-button ${offlineMapState}`}
            type="button"
            disabled={offlineMapState === 'downloading'}
            onClick={() => void cachePropertyMap()}
          >
            <Download size={14} />
            {offlineMapState === 'ready'
              ? 'Property map available offline'
              : offlineMapState === 'downloading'
                ? 'Downloading property map…'
                : activeRasterSource.allowOfflineDownload
                  ? 'Download property map'
                  : 'Preview basemap · online'}
          </button>

          <FieldMap fields={fields} readings={readings} contacts={contacts} />

          <section className="section-block">
            <div className="section-title">
              <div><p className="eyebrow">CURRENT SEASON</p><h2>Growing now</h2></div>
              <button type="button" onClick={() => setTab('fields')}>View fields</button>
            </div>
            <div className="field-grid">
              {fields.map((field) => (
                <article className="field-card" key={field.id}>
                  <div className={`crop-icon ${field.status}`}>{field.cropIcon}</div>
                  <div className="field-copy">
                    <span className="field-status">{field.status}</span>
                    <h3>{field.name}</h3>
                    <p>{field.crop}{field.variety ? ` · ${field.variety}` : ''}</p>
                  </div>
                  <div className="health">
                    <strong>{field.healthScore}</strong><span>health</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="sensor-panel">
            <div className="sensor-heading">
              <Radio size={18} />
              <div><p className="eyebrow">CHIRPSTACK</p><h2>Ground truth</h2></div>
              <span className="live-dot">Live</span>
            </div>
            {readings.map((reading) => (
              <div className="reading" key={reading.id}>
                <div>
                  <strong>{reading.label}</strong>
                  <span>{relativeTime(reading.recordedAt)} · {reading.quality}</span>
                </div>
                <p>{reading.value}<small>{reading.unit}</small></p>
              </div>
            ))}
          </section>

          {alerts.map((alert) => (
            <aside className={`alert ${alert.severity}`} key={alert.id}>
              <AlertTriangle size={20} />
              <div><strong>{alert.title}</strong><p>{alert.detail}</p></div>
              <ChevronRight size={18} />
            </aside>
          ))}

          <aside className="al-card">
            <div className="al-mark">Al</div>
            <div>
              <p className="eyebrow">READ-ONLY FIELD INSIGHT</p>
              <strong>{insights[0]?.title ?? 'No current insight'}</strong>
              <p>{insights[0]?.summary ?? 'Al insights will appear when fresh field evidence is available.'}</p>
            </div>
          </aside>
        </>
      )}

      {tab === 'fields' && (
        <section className="placeholder-page">
          <Sprout size={30} />
          <p className="eyebrow">PROPERTIES · SEASONS · ECOLOGY</p>
          <h2>Field records</h2>
          <article className="record-row">
            <span>🏡</span>
            <div>
              <strong>{properties[0]?.name}</strong>
              <p>{seasons.find((season) => season.status === 'active')?.name} · active season</p>
            </div>
            <ChevronRight />
          </article>
          {fields.map((field) => (
            <article className="record-row" key={field.id}>
              <span>{field.cropIcon}</span>
              <div><strong>{field.name}</strong><p>{field.seasonLabel} · {field.crop}</p></div>
              <ChevronRight />
            </article>
          ))}
          {ecologicalSites.map((site) => (
            <article className="record-row" key={site.id}>
              <span>🌿</span>
              <div>
                <strong>{site.name}</strong>
                <p>{site.siteType} · {site.conditionScore ?? '—'} condition</p>
              </div>
              <ChevronRight />
            </article>
          ))}
        </section>
      )}

      {tab === 'capture' && (
        <section className="placeholder-page capture-page">
          <Camera size={30} />
          <p className="eyebrow">OFFLINE-FIRST EVIDENCE</p>
          <h2>Capture an observation</h2>
          <p>Photos retain coordinates, accuracy, time, field metadata, and sync state.</p>
          <button className="primary-action" type="button" onClick={() => void takePhoto()}>
            <Camera size={19} /> Take geotagged photo
          </button>
          <button className="secondary-action" type="button" onClick={() => void recordVideo()}>
            <Video size={19} /> Record geotagged video
          </button>
          <button className="secondary-action" type="button" disabled={!depth.supported}>
            <ScanLine size={19} />
            {depth.supported ? `Start ${depth.provider} scan` : 'Depth unavailable on this device'}
          </button>
          {depth.reason && <small className="capability-note">{depth.reason}</small>}
        </section>
      )}

      {tab === 'team' && (
        <section className="placeholder-page">
          <Users size={30} />
          <p className="eyebrow">TAK NETWORK</p>
          <h2>Team contacts</h2>
          {connection === 'not_enrolled' || connection === 'disconnected' ? (
            <>
              <input
                ref={enrollmentInput}
                className="visually-hidden"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) =>
                  void enrollTak(event.currentTarget.files?.[0])
                }
              />
              <button
                className="primary-action enrollment-action"
                type="button"
                onClick={() => enrollmentInput.current?.click()}
              >
                <Download size={18} /> Import TAK server package
              </button>
            </>
          ) : null}
          {contacts.map((contact) => (
            <article className="record-row" key={contact.uid}>
              <span className="team-avatar">{contact.callsign.slice(0, 2)}</span>
              <div><strong>{contact.callsign}</strong><p>{contact.team ?? 'No team'} · active</p></div>
              <MessageCircle size={19} />
            </article>
          ))}
        </section>
      )}

      {notice && (
        <button className="toast" type="button" onClick={() => setNotice(null)}>
          {notice}
        </button>
      )}

      <nav className="bottom-nav" aria-label="Primary navigation">
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}><Map /><span>Map</span></button>
        <button className={tab === 'fields' ? 'active' : ''} onClick={() => setTab('fields')}><Leaf /><span>Fields</span></button>
        <button className={tab === 'capture' ? 'active capture' : 'capture'} onClick={() => setTab('capture')}><Camera /><span>Capture</span></button>
        <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}><Users /><span>Team</span></button>
      </nav>
    </main>
  )
}
