import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ChevronRight,
  Download,
  Leaf,
  Map,
  Radio,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { CapturePanel } from './components/CapturePanel'
import { FieldMap } from './components/FieldMap'
import { FieldRecords } from './components/FieldRecords'
import { OfflineMapManager } from './components/OfflineMapManager'
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
  type ObservationCaptureInput,
} from './media/observationCapture'
import {
  captureDepthObservation,
  type DepthScanMode,
} from './media/depthObservation'
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
import { startSyncScheduler } from './sync/scheduler'
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
    offlineMapRegions,
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
    if (connection !== 'connected' || !takTransport.isNative()) return
    return startSyncScheduler(() =>
      Promise.allSettled([flushTakOutbox(), synchronizeFieldData()]),
    )
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

  async function takePhoto(input: ObservationCaptureInput) {
    const capture = await captureObservationPhoto(input)
    setNotice(
      `Observation queued at ${capture.observation.coordinate.latitude.toFixed(5)}, ${capture.observation.coordinate.longitude.toFixed(5)}.`,
    )
  }

  async function recordVideo(input: ObservationCaptureInput) {
    const capture = await captureObservationVideo(input)
    setNotice(
      `Video observation queued at ${capture.observation.coordinate.latitude.toFixed(5)}, ${capture.observation.coordinate.longitude.toFixed(5)}.`,
    )
  }

  async function captureDepth(
    input: ObservationCaptureInput,
    mode: DepthScanMode,
  ) {
    const captured = await captureDepthObservation(input, mode)
    const median = captured.scan.measurements.find(
      (measurement) => measurement.label === 'Median range',
    )
    setNotice(
      `${captured.media.length} depth artifacts queued offline${
        median ? ` · median range ${median.value.toFixed(2)} m` : ''
      }.`,
    )
  }

  async function enrollTak(file: File | undefined) {
    if (!file) return
    setNotice('Validating and importing the TAK certificate package…')
    try {
      const profile = await importTakDataPackage(file)
      setNotice(`Enrolled ${profile.callsign} with ${profile.name}.`)
      const status = await takTransport.connect(profile.id)
      setConnection(status.state)
      setProfile(status.profile)
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'TAK enrollment failed.',
      )
    } finally {
      if (enrollmentInput.current) enrollmentInput.current.value = ''
    }
  }

  async function removeTakEnrollment() {
    if (
      !window.confirm(
        'Remove this TAK certificate enrollment and its private identity from this device?',
      )
    ) return
    try {
      await takTransport.removeEnrollment()
      setConnection('not_enrolled')
      setProfile(null)
      setContacts([])
      setNotice('TAK enrollment and device credentials were removed.')
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'TAK enrollment removal failed.',
      )
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

          <OfflineMapManager
            properties={properties}
            regions={offlineMapRegions}
            source={activeRasterSource}
            onNotice={setNotice}
          />

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
        <CapturePanel
          fields={fields}
          ecologicalSites={ecologicalSites}
          depth={depth}
          onPhoto={takePhoto}
          onVideo={recordVideo}
          onDepth={captureDepth}
        />
      )}

      {tab === 'team' && (
        <section className="placeholder-page">
          <Users size={30} />
          <p className="eyebrow">TAK NETWORK</p>
          <h2>Team contacts</h2>
          {takTransport.isNative() ? (
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
                disabled={connection === 'connecting'}
                onClick={() => enrollmentInput.current?.click()}
              >
                <Download size={18} />
                {profile
                  ? 'Replace TAK server package'
                  : 'Import TAK server package'}
              </button>
            </>
          ) : null}
          {takTransport.isNative() && profile && (
            <button
              className="remove-enrollment-action"
              type="button"
              onClick={() => void removeTakEnrollment()}
            >
              Remove certificate enrollment
            </button>
          )}
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
