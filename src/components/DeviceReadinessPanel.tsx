import { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Share2,
  ShieldCheck,
} from 'lucide-react'
import {
  collectDeviceReadiness,
  shareDeviceReadiness,
  type DeviceReadinessReport,
} from '../device/readiness'

interface DeviceReadinessPanelProps {
  contactCount: number
  collect?: (contactCount: number) => Promise<DeviceReadinessReport>
  share?: (
    report: DeviceReadinessReport,
  ) => Promise<'shared' | 'downloaded'>
}

function statusIcon(status: DeviceReadinessReport['checks'][number]['status']) {
  if (status === 'pass') return <CheckCircle2 size={16} />
  if (status === 'attention') return <AlertTriangle size={16} />
  return <AlertCircle size={16} />
}

function formatBytes(value: number | null) {
  if (value === null) return 'Unavailable'
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function DeviceReadinessPanel({
  contactCount,
  collect = collectDeviceReadiness,
  share = shareDeviceReadiness,
}: DeviceReadinessPanelProps) {
  const [report, setReport] = useState<DeviceReadinessReport | null>(null)
  const [running, setRunning] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    setNotice(null)
    try {
      setReport(await collect(contactCount))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Device readiness could not be collected.',
      )
    } finally {
      setRunning(false)
    }
  }

  async function shareReport() {
    if (!report) return
    setSharing(true)
    setError(null)
    setNotice(null)
    try {
      const result = await share(report)
      setNotice(
        result === 'shared'
          ? 'Readiness evidence shared.'
          : 'Readiness evidence downloaded.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Readiness evidence could not be shared.',
      )
    } finally {
      setSharing(false)
    }
  }

  return (
    <section className="device-readiness" aria-labelledby="readiness-title">
      <header>
        <div>
          <ClipboardCheck size={19} />
          <div>
            <p className="eyebrow">RELEASE EVIDENCE</p>
            <h3 id="readiness-title">Device readiness</h3>
          </div>
        </div>
        {report && (
          <span className={`readiness-overall ${report.overall}`}>
            {report.overall}
          </span>
        )}
      </header>

      {!report && (
        <p className="readiness-intro">
          Record a sanitized build, device, TAK, depth, offline-map, sync, and
          media-integrity snapshot for physical testing.
        </p>
      )}

      {report && (
        <>
          <dl className="readiness-summary">
            <div>
              <dt>Build</dt>
              <dd>
                {report.app.version} ({report.app.build})
                {' · '}
                {report.app.sourceRevision.slice(0, 7)}
              </dd>
            </div>
            <div>
              <dt>Device</dt>
              <dd>{report.device.model} · {report.device.osVersion}</dd>
            </div>
            <div>
              <dt>Storage used</dt>
              <dd>{formatBytes(report.runtime.storageEstimateBytes)}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>{new Date(report.generatedAt).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="readiness-checks">
            {report.checks.map((check) => (
              <article className={check.status} key={check.id}>
                {statusIcon(check.status)}
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="readiness-privacy">
            <ShieldCheck size={14} />
            Excludes device/profile IDs, server addresses, personal device
            names, credentials, coordinates, messages, notes, and media contents.
          </p>
        </>
      )}

      {error && <p className="readiness-message error" role="alert">{error}</p>}
      {notice && <p className="readiness-message" role="status">{notice}</p>}

      <div className="readiness-actions">
        <button type="button" disabled={running} onClick={() => void run()}>
          <RefreshCw size={15} />
          {running
            ? 'Checking device…'
            : report
              ? 'Refresh report'
              : 'Run readiness check'}
        </button>
        {report && (
          <button
            type="button"
            disabled={sharing}
            onClick={() => void shareReport()}
          >
            <Share2 size={15} />
            {sharing ? 'Preparing…' : 'Share JSON evidence'}
          </button>
        )}
      </div>
    </section>
  )
}
