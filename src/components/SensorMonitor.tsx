import { Activity, Radio, Signal, SignalLow, WifiOff } from 'lucide-react'
import type { SensorReading } from '../domain/models'
import {
  buildSensorChannels,
  type SensorChannel,
  type SensorFreshness,
  type SensorTrend,
} from '../domain/sensorMonitoring'

interface SensorMonitorProps {
  readings: SensorReading[]
  now?: Date
}

function relativeTime(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function freshnessIcon(freshness: SensorFreshness) {
  if (freshness === 'live') return <Signal size={16} aria-hidden="true" />
  if (freshness === 'stale') return <SignalLow size={16} aria-hidden="true" />
  return <WifiOff size={16} aria-hidden="true" />
}

function trendLabel(channel: SensorChannel) {
  const labels: Record<SensorTrend, string> = {
    rising: 'rising',
    falling: 'falling',
    steady: 'steady',
    new: 'first sample',
  }
  if (channel.delta === null) return labels[channel.trend]
  const sign = channel.delta > 0 ? '+' : ''
  return `${labels[channel.trend]} ${sign}${channel.delta.toFixed(2)} ${channel.latest.unit}`
}

function channelAssignment(channel: SensorChannel) {
  if (channel.latest.fieldId) return 'crop field'
  if (channel.latest.siteId) return 'ecological site'
  return 'unassigned'
}

export function SensorMonitor({ readings, now = new Date() }: SensorMonitorProps) {
  const channels = buildSensorChannels(readings, now)
  const liveCount = channels.filter((channel) => channel.freshness === 'live').length

  return (
    <section className="sensor-panel" aria-label="LoRaWAN sensor monitoring">
      <div className="sensor-heading">
        <Radio size={18} />
        <div>
          <p className="eyebrow">CHIRPSTACK</p>
          <h2>Ground truth</h2>
        </div>
        <span className={`sensor-summary ${liveCount > 0 ? 'live' : 'offline'}`}>
          {liveCount} live / {channels.length}
        </span>
      </div>

      {channels.length === 0 && (
        <p className="records-muted">No sensor readings have synchronized yet.</p>
      )}

      {channels.map((channel) => (
        <details className={`sensor-channel ${channel.freshness}`} key={channel.key}>
          <summary>
            <span className="sensor-state">
              {freshnessIcon(channel.freshness)}
              <span>
                <strong>{channel.latest.label}</strong>
                <small>
                  {channel.freshness} · {relativeTime(channel.ageMilliseconds)}
                </small>
              </span>
            </span>
            <span className="sensor-value">
              {channel.latest.value}
              <small>{channel.latest.unit}</small>
            </span>
          </summary>
          <div className="sensor-diagnostics">
            <p><Activity size={14} /> {trendLabel(channel)} · {channel.sampleCount} sample{channel.sampleCount === 1 ? '' : 's'}</p>
            <dl>
              <div><dt>Device</dt><dd>{channel.deviceId}</dd></div>
              <div><dt>Assignment</dt><dd>{channelAssignment(channel)}</dd></div>
              <div><dt>Quality</dt><dd>{channel.latest.quality}</dd></div>
              {channel.latest.lorawan && (
                <>
                  <div><dt>DevEUI</dt><dd>{channel.latest.lorawan.devEui}</dd></div>
                  <div><dt>Frame</dt><dd>{channel.latest.lorawan.frameCounter}</dd></div>
                  <div><dt>RSSI / SNR</dt><dd>{channel.latest.lorawan.rssi ?? '—'} dBm / {channel.latest.lorawan.snr ?? '—'} dB</dd></div>
                  <div><dt>Gateways</dt><dd>{channel.latest.lorawan.gatewayIds.length}</dd></div>
                </>
              )}
            </dl>
          </div>
        </details>
      ))}
    </section>
  )
}
