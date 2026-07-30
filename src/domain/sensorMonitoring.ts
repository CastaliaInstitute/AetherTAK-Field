import type { SensorReading } from './models'

export type SensorFreshness = 'live' | 'stale' | 'offline'
export type SensorTrend = 'rising' | 'falling' | 'steady' | 'new'

export interface SensorChannel {
  key: string
  deviceId: string
  measurement: SensorReading['measurement']
  latest: SensorReading
  previous: SensorReading | null
  sampleCount: number
  freshness: SensorFreshness
  ageMilliseconds: number
  trend: SensorTrend
  delta: number | null
}

export const SENSOR_LIVE_WINDOW_MS = 15 * 60 * 1_000
export const SENSOR_STALE_WINDOW_MS = 2 * 60 * 60 * 1_000

function channelKey(reading: SensorReading) {
  return `${reading.deviceId}:${reading.measurement}`
}

function trend(
  latest: SensorReading,
  previous: SensorReading | null,
): Pick<SensorChannel, 'trend' | 'delta'> {
  if (!previous) return { trend: 'new', delta: null }
  const delta = latest.value - previous.value
  if (Math.abs(delta) < 0.000_001) return { trend: 'steady', delta: 0 }
  return { trend: delta > 0 ? 'rising' : 'falling', delta }
}

export function sensorFreshness(
  recordedAt: string,
  now = new Date(),
): Pick<SensorChannel, 'freshness' | 'ageMilliseconds'> {
  const ageMilliseconds = Math.max(
    0,
    now.getTime() - new Date(recordedAt).getTime(),
  )
  return {
    ageMilliseconds,
    freshness:
      ageMilliseconds <= SENSOR_LIVE_WINDOW_MS
        ? 'live'
        : ageMilliseconds <= SENSOR_STALE_WINDOW_MS
          ? 'stale'
          : 'offline',
  }
}

export function buildSensorChannels(
  readings: SensorReading[],
  now = new Date(),
): SensorChannel[] {
  const grouped = new Map<string, SensorReading[]>()
  for (const reading of readings) {
    const key = channelKey(reading)
    grouped.set(key, [...(grouped.get(key) ?? []), reading])
  }

  return [...grouped.entries()]
    .map(([key, samples]) => {
      const ordered = [...samples].sort(
        (left, right) =>
          new Date(right.recordedAt).getTime() -
          new Date(left.recordedAt).getTime(),
      )
      const latest = ordered[0]
      const previous = ordered[1] ?? null
      return {
        key,
        deviceId: latest.deviceId,
        measurement: latest.measurement,
        latest,
        previous,
        sampleCount: ordered.length,
        ...sensorFreshness(latest.recordedAt, now),
        ...trend(latest, previous),
      }
    })
    .sort(
      (left, right) =>
        new Date(right.latest.recordedAt).getTime() -
        new Date(left.latest.recordedAt).getTime(),
    )
}

export function selectLatestSensorReadings(readings: SensorReading[]) {
  return buildSensorChannels(readings).map((channel) => channel.latest)
}
