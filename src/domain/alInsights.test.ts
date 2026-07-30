import { describe, expect, it } from 'vitest'
import { demoInsights, demoReadings } from './seed'
import {
  activeAlInsights,
  alInsightEvidence,
  alInsightRemaining,
  nextAlInsightExpiry,
} from './alInsights'

const current = {
  ...demoInsights[0],
  generatedAt: '2026-07-30T10:00:00.000Z',
  expiresAt: '2026-07-30T11:00:00.000Z',
}

describe('read-only Al insight lifecycle', () => {
  it('fails closed at the expiry boundary and for malformed timestamps', () => {
    const expired = {
      ...current,
      id: '3ed16479-c99d-4d10-a7c6-d412b7f3ab26',
      expiresAt: '2026-07-30T09:59:59.999Z',
    }
    const malformed = {
      ...current,
      id: 'd47df563-31c0-4465-854b-e78796b1b1a4',
      expiresAt: 'not-a-time',
    }

    expect(activeAlInsights(
      [expired, current, malformed],
      new Date('2026-07-30T10:59:59.999Z'),
    )).toEqual([current])
    expect(activeAlInsights(
      [current],
      new Date('2026-07-30T11:00:00.000Z'),
    )).toEqual([])
  })

  it('orders attention before information and then newest first', () => {
    const olderAttention = {
      ...current,
      id: '0f7a49ef-272d-4346-a060-a43b52a7cfda',
      severity: 'attention' as const,
      generatedAt: '2026-07-30T09:00:00.000Z',
    }
    const newerAttention = {
      ...olderAttention,
      id: 'fd226a43-c19a-4c5c-b2c0-e7af04bf332c',
      generatedAt: '2026-07-30T10:30:00.000Z',
    }

    expect(activeAlInsights(
      [current, olderAttention, newerAttention],
      new Date('2026-07-30T10:45:00.000Z'),
    ).map((insight) => insight.id)).toEqual([
      newerAttention.id,
      olderAttention.id,
      current.id,
    ])
  })

  it('resolves only declared source readings in declaration order', () => {
    const second = {
      ...demoReadings[1],
      recordedAt: '2026-07-30T09:30:00.000Z',
    }
    const first = {
      ...demoReadings[0],
      recordedAt: '2026-07-30T09:45:00.000Z',
    }
    const insight = {
      ...current,
      sourceReadingIds: [
        second.id,
        '4e40008b-bdaa-4e4a-850f-e967eb174f47',
        first.id,
      ],
    }

    expect(alInsightEvidence(
      insight,
      [first, second],
      new Date('2026-07-30T10:00:00.000Z'),
    )).toEqual([
      { reading: second, ageMilliseconds: 30 * 60_000 },
      { reading: first, ageMilliseconds: 15 * 60_000 },
    ])
  })

  it('reports a bounded remaining lifetime', () => {
    expect(alInsightRemaining(
      current,
      new Date('2026-07-30T10:45:00.000Z'),
    )).toBe(15 * 60_000)
    expect(alInsightRemaining(
      current,
      new Date('2026-07-30T11:30:00.000Z'),
    )).toBe(0)
  })

  it('schedules the earliest valid future expiry', () => {
    const later = {
      ...current,
      id: '481976e4-821b-47ec-86fe-223720afdad9',
      expiresAt: '2026-07-30T12:00:00.000Z',
    }
    const malformed = {
      ...current,
      id: '5ed343f4-391b-472e-9681-a8b3cfbf3992',
      expiresAt: 'invalid',
    }

    expect(nextAlInsightExpiry(
      [later, current, malformed],
      new Date('2026-07-30T10:00:00.000Z'),
    )).toBe(new Date(current.expiresAt).getTime())
    expect(nextAlInsightExpiry(
      [current],
      new Date(current.expiresAt),
    )).toBeNull()
  })
})
