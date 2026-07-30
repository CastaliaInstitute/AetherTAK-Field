import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ChevronRight,
  Download,
  Leaf,
  Map,
  Radio,
  ScanLine,
  Users,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { FieldMap } from './components/FieldMap'
import { FieldRecords } from './components/FieldRecords'
import {
  TakMapComposer,
  TakTeamPanel,
} from './components/TakCollaboration'
import { demoSnapshot } from './domain/seed'
import { useDashboard } from './data/useDashboard'
import type {
  Coordinate,
  DepthCapability,
  TakConnectionState,
  TakContact,
} from './domain/models'
import {
  captureObservationPhoto,
  captureObservationVideo,
} from './media/observationCapture'
import { captureDepthObservation } from './media/depthObservation'
import { depthScanner } from './platform/depth'
import {
  takTransport,
  type TakServerProfile,
} from './platform/tak'
import {
  currentCoordinate,
  watchCurrentCoordinate,
} from './platform/capture'
import { synchronizeFieldData } from './sync/fieldSync'
import {
  flushTakOutbox,
  queueTakOperation,
} from './tak/outbox'
import {
  recentTakActivity,
  recordInboundCot,
  type TakActivity,
} from './tak/activity'
import type {
  EmergencyOperation,
  TakIdentity,
  TakOperation,
} from './tak/operations'
import {
  createOfflineMapRegion,
  downloadOfflineMapRegion,
} from './maps/offlineRegions'
import { activeRasterSource } from './maps/tileSource'
import { importTakDataPackage } from './tak/enrollmentImport'
import './App.css'

type Tab = 'map' | 'fields' | 'capture' | 'team'
type MapDraft = {
  kind: 'marker' | 'route' | 'shape'
  points: Coordinate[]
}

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
  const [profile, setProfile] = useState<TakServerProfile | null>(null)
  const [contacts, setContacts] = useState<TakContact[]>(
    takTransport.isNative() ? [] : demoSnapshot.contacts,
  )
  const [takActivity, setTakActivity] = useState<TakActivity[]>([])
  const [mapDraft, setMapDraft] = useState<MapDraft | null>(null)
  const [depth, setDepth] = useState<DepthCapability>(initialDepth)
  const [notice, setNotice] = useState<string | null>(null)
  const [offlineMapState, setOfflineMapState] = useState<
    'idle' | 'downloading' | 'ready'
  >('idle')
  const enrollmentInput = useRef<HTMLInputElement>(null)
  const {
    data: dashboard,
    loading: dashboardLoading,
    error: dashboardError,
  } = useDashboard()
  const {
    properties,
    fields,
    ecologicalSites,
    readings,
    alerts,
    insights,
  } = dashboard

  useEffect(() => {
    void takTransport.status().then((status) => {
      setConnection(status.state)
      setProfile(status.profile)
    })
    void depthScanner.capability().then(setDepth)
    void recentTakActivity().then(setTakActivity)
  }, [])

  useEffect(() => {
    if (!takTransport.isNative() || connection !== 'connected') return
    let cancelled = false
    const refreshContacts = async () => {
      const next = await takTransport.contacts()
      if (!cancelled) setContacts(next)
    }
    void refreshContacts()
    const timer = window.setInterval(() => void refreshContacts(), 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connection])

  useEffect(() => {
    let disposed = false
    let remove: (() => Promise<void>) | undefined
    void takTransport.onCotEvent((xml) => {
      void recordInboundCot(xml)
        .then(() => recentTakActivity())
        .then((items) => {
          if (!disposed) setTakActivity(items)
        })
        .catch(() => undefined)
    }).then((handle) => {
      if (!handle) return
      if (disposed) {
        void handle.remove()
      } else {
        remove = handle.remove
      }
    })
    return () => {
      disposed = true
      if (remove) void remove()
    }
  }, [])

  useEffect(() => {
    const synchronize = () => {
      if (connection !== 'connected' || !navigator.onLine) return
      void Promise.allSettled([flushTakOutbox(), synchronizeFieldData()])
    }
    synchronize()
    window.addEventListener('online', synchronize)
    return () => window.removeEventListener('online', synchronize)
  }, [connection])

  const averageHealth = useMemo(() => {
    const scored = fields.flatMap((field) =>
      field.healthScore === null ? [] : [field.healthScore],
    )
    return scored.length
      ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
      : 0
  }, [fields])

  const identity = useMemo<TakIdentity>(() => ({
    uid: profile ? `AETHER-${profile.id}` : 'AETHER-FIELD-PREVIEW',
    callsign: profile?.callsign ?? 'Field Preview',
    team: profile?.team ?? 'Green',
    role: 'Team Member',
  }), [profile])

  useEffect(() => {
    if (connection !== 'connected' || !takTransport.isNative()) return
    let disposed = false
    let publishing = false
    let lastPublishedAt = 0
    let stop: (() => Promise<void>) | undefined
    void watchCurrentCoordinate((coordinate) => {
      const now = Date.now()
      if (
        disposed ||
        publishing ||
        now - lastPublishedAt < 15_000
      ) return
      publishing = true
      lastPublishedAt = now
      void queueTakOperation({
        kind: 'position',
        uid: identity.uid,
        identity,
        coordinate,
        createdAt: new Date(now).toISOString(),
        staleSeconds: 45,
      })
        .then(() => flushTakOutbox())
        .then(() => recentTakActivity())
        .then((items) => {
          if (!disposed) setTakActivity(items)
        })
        .catch(() => undefined)
        .finally(() => {
          publishing = false
        })
    }).then((cleanup) => {
      if (disposed) {
        void cleanup()
      } else {
        stop = cleanup
      }
    }).catch(() => undefined)
    return () => {
      disposed = true
      if (stop) void stop()
    }
  }, [connection, identity])

  async function refreshTakActivity() {
    setTakActivity(await recentTakActivity())
  }

  async function dispatchTakOperation(operation: TakOperation) {
    await queueTakOperation(operation)
    await refreshTakActivity()
    if (connection === 'connected' && navigator.onLine) {
      const result = await flushTakOutbox()
      await refreshTakActivity()
      setNotice(
        result.failed
          ? `TAK event retained offline after a delivery error.`
          : `${result.sent} TAK event${result.sent === 1 ? '' : 's'} delivered.`,
      )
    } else {
      setNotice('TAK event queued offline and will send after reconnection.')
    }
  }

  function addDraftPoint(coordinate: Coordinate) {
    setMapDraft((current) => {
      if (!current) return null
      return {
        ...current,
        points:
          current.kind === 'marker'
            ? [coordinate]
            : [...current.points, coordinate].slice(0, 100),
      }
    })
  }

  async function sendMapDraft(title: string, remarks: string) {
    if (!mapDraft) return
    const createdAt = new Date().toISOString()
    const uid = `AetherTAK-Field.${mapDraft.kind}.${crypto.randomUUID()}`
    let operation: TakOperation
    if (mapDraft.kind === 'marker') {
      operation = {
        kind: 'marker',
        uid,
        callsign: title,
        coordinate: mapDraft.points[0],
        remarks: remarks || undefined,
        cotType: 'a-u-G',
        createdAt,
      }
    } else if (mapDraft.kind === 'route') {
      operation = {
        kind: 'route',
        uid,
        title,
        colorArgb: 0xff71d4d1 | 0,
        points: mapDraft.points,
        createdAt,
      }
    } else {
      operation = {
        kind: 'shape',
        uid,
        title,
        colorArgb: 0xffefb75e | 0,
        closed: true,
        points: mapDraft.points,
        createdAt,
      }
    }
    await dispatchTakOperation(operation)
    setMapDraft(null)
  }

  async function sendChat(contact: TakContact, message: string) {
    await dispatchTakOperation({
      kind: 'chat',
      uid: `GeoChat.${identity.uid}.${contact.uid}.${crypto.randomUUID()}`,
      sender: identity,
      recipientUid: contact.uid,
      conversationId: contact.uid,
      conversationName: contact.callsign,
      message,
      createdAt: new Date().toISOString(),
    })
  }

  async function sendEmergency(
    emergencyType: EmergencyOperation['emergencyType'],
  ) {
    setNotice('Acquiring a precise location for the emergency signal…')
    const coordinate = await currentCoordinate()
    await dispatchTakOperation({
      kind: 'emergency',
      uid: `AetherTAK-Field.emergency.${identity.uid}`,
      identity,
      coordinate,
      emergencyType,
      createdAt: new Date().toISOString(),
      staleSeconds: emergencyType === 'Cancel' ? 60 : 600,
    })
  }

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

  async function captureDepth() {
    const mode = depth.supportsMesh ? 'mesh' : 'point_cloud'
    setNotice('Acquiring location and starting the native depth scanner…')
    try {
      const captured = await captureDepthObservation(
        {
          fieldId: fields[0]?.id ?? null,
          siteId: null,
          category: 'crop',
          title: 'Field depth scan',
          notes: 'Depth evidence captured in AetherTAK Field.',
        },
        mode,
      )
      const median = captured.scan.measurements.find(
        (measurement) => measurement.label === 'Median range',
      )
      setNotice(
        `${captured.media.length} depth artifacts queued offline${
          median ? ` · median range ${median.value.toFixed(2)} m` : ''
        }.`,
      )
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Depth capture was cancelled.',
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
          onClick={() => void takTransport.connect().then((value) => {
            setConnection(value.state)
            setProfile(value.profile)
          })}
        >
          {connection === 'connected' ? <Wifi size={17} /> : <WifiOff size={17} />}
          <span>{connection === 'connected' ? 'TAK live' : 'TAK preview'}</span>
        </button>
      </header>

      {tab === 'map' && (
        <>
          {dashboardLoading && (
            <p className="dashboard-state" role="status">Loading offline field records…</p>
          )}
          {dashboardError && (
            <p className="dashboard-state error" role="alert">{dashboardError}</p>
          )}
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

          <FieldMap
            fields={fields}
            readings={readings}
            contacts={contacts}
            activity={takActivity}
            draft={mapDraft}
            onMapPress={mapDraft ? addDraftPoint : null}
          />
          <TakMapComposer
            draft={
              mapDraft
                ? { kind: mapDraft.kind, pointCount: mapDraft.points.length }
                : null
            }
            onStart={(kind) => setMapDraft({ kind, points: [] })}
            onUndo={() =>
              setMapDraft((current) =>
                current
                  ? { ...current, points: current.points.slice(0, -1) }
                  : null,
              )
            }
            onCancel={() => setMapDraft(null)}
            onSubmit={sendMapDraft}
          />

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
        <FieldRecords data={dashboard} onNotice={setNotice} />
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
          <button
            className="secondary-action"
            type="button"
            disabled={!depth.supported}
            onClick={() => void captureDepth()}
          >
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
          <TakTeamPanel
            callsign={identity.callsign}
            contacts={contacts}
            activity={takActivity}
            queuedCount={
              takActivity.filter(
                (item) =>
                  item.deliveryStatus === 'queued' ||
                  item.deliveryStatus === 'failed',
              ).length
            }
            onSendChat={sendChat}
            onSendEmergency={sendEmergency}
          />
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
