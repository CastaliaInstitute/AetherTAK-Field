import { Clock3, Database, ShieldCheck } from 'lucide-react'
import type { AlInsight, SensorReading } from '../domain/models'
import {
  alInsightEvidence,
  alInsightRemaining,
} from '../domain/alInsights'
import { formatSensorValue } from '../maps/fieldLayers'

interface AlInsightsPanelProps {
  insights: AlInsight[]
  readings: SensorReading[]
  now?: Date
}

function relativeDuration(milliseconds: number) {
  const minutes = Math.ceil(milliseconds / 60_000)
  if (minutes <= 1) return 'less than 1 minute'
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.ceil(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

function evidenceAge(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return 'unknown time'
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function AlInsightsPanel({
  insights,
  readings,
  now = new Date(),
}: AlInsightsPanelProps) {
  return (
    <section className="al-panel" aria-labelledby="al-insights-heading">
      <header className="al-heading">
        <div className="al-mark" aria-hidden="true">Al</div>
        <div>
          <p className="eyebrow">ADVISORY · READ ONLY</p>
          <h2 id="al-insights-heading">Field insights</h2>
        </div>
        <span className="al-readonly">
          <ShieldCheck size={14} aria-hidden="true" />
          No controls
        </span>
      </header>

      {insights.length === 0 && (
        <p className="records-muted">
          No current insight. Expired advice is removed automatically.
        </p>
      )}

      {insights.map((insight) => {
        const evidence = alInsightEvidence(insight, readings, now)
        const sourceCount = insight.sourceReadingIds.length
        return (
          <details
            className={`al-insight ${insight.severity}`}
            key={insight.id}
          >
            <summary>
              <span>
                <strong>{insight.title}</strong>
                <small>{insight.summary}</small>
              </span>
              <span className="al-expiry">
                <Clock3 size={13} aria-hidden="true" />
                expires in {relativeDuration(alInsightRemaining(insight, now))}
              </span>
            </summary>
            <div className="al-detail">
              <p>{insight.rationale || 'No additional rationale was supplied.'}</p>
              <div className="al-evidence-heading">
                <Database size={14} aria-hidden="true" />
                <strong>
                  Source evidence · {evidence.length}/{sourceCount} available
                </strong>
              </div>
              {sourceCount === 0 && (
                <p className="al-evidence-warning">
                  This advisory names no source readings.
                </p>
              )}
              {sourceCount > evidence.length && (
                <p className="al-evidence-warning">
                  Some referenced readings are not present on this device.
                </p>
              )}
              {evidence.map(({ reading, ageMilliseconds }) => (
                <dl className="al-evidence" key={reading.id}>
                  <div>
                    <dt>{reading.label}</dt>
                    <dd>{formatSensorValue(reading)}</dd>
                  </div>
                  <div>
                    <dt>{reading.measurement.replaceAll('_', ' ')}</dt>
                    <dd>{evidenceAge(ageMilliseconds)} · {reading.quality}</dd>
                  </div>
                </dl>
              ))}
              <p className="al-boundary">
                Al can summarize synchronized evidence but cannot change field
                records, acknowledge alerts, or send TAK events.
              </p>
            </div>
          </details>
        )
      })}
    </section>
  )
}
