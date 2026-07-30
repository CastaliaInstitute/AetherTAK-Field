import type { AlInsight, SensorReading } from './models'

export interface AlInsightEvidence {
  reading: SensorReading
  ageMilliseconds: number
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export function activeAlInsights(
  insights: AlInsight[],
  now = new Date(),
) {
  const nowMilliseconds = now.getTime()
  return insights
    .filter((insight) => {
      const expiresAt = timestamp(insight.expiresAt)
      return expiresAt !== null && expiresAt > nowMilliseconds
    })
    .sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity === 'attention' ? -1 : 1
      }
      return (
        (timestamp(right.generatedAt) ?? 0) -
        (timestamp(left.generatedAt) ?? 0)
      )
    })
}

export function alInsightEvidence(
  insight: AlInsight,
  readings: SensorReading[],
  now = new Date(),
): AlInsightEvidence[] {
  const readingById = new Map(readings.map((reading) => [reading.id, reading]))
  return insight.sourceReadingIds.flatMap((id) => {
    const reading = readingById.get(id)
    if (!reading) return []
    const recordedAt = timestamp(reading.recordedAt)
    return [{
      reading,
      ageMilliseconds:
        recordedAt === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, now.getTime() - recordedAt),
    }]
  })
}

export function alInsightRemaining(
  insight: AlInsight,
  now = new Date(),
) {
  const expiresAt = timestamp(insight.expiresAt)
  if (expiresAt === null) return 0
  return Math.max(0, expiresAt - now.getTime())
}

export function nextAlInsightExpiry(
  insights: AlInsight[],
  now = new Date(),
) {
  const nowMilliseconds = now.getTime()
  const candidates = insights.flatMap((insight) => {
    const expiresAt = timestamp(insight.expiresAt)
    return expiresAt !== null && expiresAt > nowMilliseconds
      ? [expiresAt]
      : []
  })
  return candidates.length > 0 ? Math.min(...candidates) : null
}
