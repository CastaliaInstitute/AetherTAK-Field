import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../data/database'
import {
  discardGuardianAction,
  flushGuardianActions,
  queueGuardianAction,
  retryGuardianAction,
} from './actions'

const targetId = '88be2f51-6e6d-4a0a-85bf-0fa42d25a0de'
const now = new Date('2026-07-30T18:30:00.000Z')

function receipt(
  item: Awaited<ReturnType<typeof queueGuardianAction>>,
  replay = false,
) {
  return {
    status: 200,
    body: {
      accepted: true,
      idempotencyKey: item.id,
      action: item.kind,
      targetId: item.targetId,
      serverTime: '2026-07-30T18:30:01.000Z',
      entityVersion: 4,
      idempotentReplay: replay,
    },
  }
}

describe('Guardian durable action outbox', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterAll(async () => {
    db.close()
    await db.delete()
  })

  it('sends a check-in with one stable idempotency key', async () => {
    const item = await queueGuardianAction({
      kind: 'check_in',
      targetId,
      now,
    })
    const guardianAction = vi.fn(async () => receipt(item))

    expect(await flushGuardianActions({ guardianAction }, now)).toEqual({
      sent: 1,
      failed: 0,
      remaining: 0,
    })
    expect(guardianAction).toHaveBeenCalledWith({
      idempotencyKey: item.id,
      kind: 'check_in',
      targetId,
      reason: null,
      occurredAt: now.toISOString(),
    })
  })

  it('requires a bounded reason before queuing resolution', async () => {
    await expect(
      queueGuardianAction({
        kind: 'resolve',
        targetId,
        reason: ' ',
        now,
      }),
    ).rejects.toThrow()
    expect(await db.guardianActions.count()).toBe(0)
  })

  it('retains a transient failure and safely accepts an idempotent replay', async () => {
    const item = await queueGuardianAction({
      kind: 'acknowledge',
      targetId,
      now,
    })
    const guardianAction = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(receipt(item, true))

    expect(await flushGuardianActions({ guardianAction }, now)).toMatchObject({
      sent: 0,
      failed: 1,
      remaining: 1,
    })
    const retained = await db.guardianActions.get(item.id)
    expect(retained).toMatchObject({ attempts: 1, lastError: 'offline' })

    await retryGuardianAction(item.id, new Date(now.getTime() + 1_000))
    expect(
      await flushGuardianActions(
        { guardianAction },
        new Date(now.getTime() + 1_000),
      ),
    ).toMatchObject({ sent: 1, remaining: 0 })
    expect(guardianAction.mock.calls[0][0].idempotencyKey).toBe(
      guardianAction.mock.calls[1][0].idempotencyKey,
    )
  })

  it('rejects a mismatched receipt and retains the action', async () => {
    const item = await queueGuardianAction({
      kind: 'acknowledge',
      targetId,
      now,
    })
    const guardianAction = vi.fn(async () => ({
      ...receipt(item),
      body: {
        ...receipt(item).body,
        targetId: '2ef8e548-27f6-4faf-9c35-b536b4d30599',
      },
    }))

    expect(await flushGuardianActions({ guardianAction }, now)).toMatchObject({
      failed: 1,
      remaining: 1,
    })
    expect((await db.guardianActions.get(item.id))?.lastError).toMatch(
      /different action/,
    )
  })

  it('allows an operator to discard a permanently rejected action', async () => {
    const item = await queueGuardianAction({
      kind: 'resolve',
      targetId,
      reason: 'Condition verified safe.',
      now,
    })
    const guardianAction = vi.fn(async () => ({
      status: 403,
      body: { error: { message: 'Not authorized.' } },
    }))

    await flushGuardianActions({ guardianAction }, now)
    expect(await db.guardianActions.get(item.id)).toMatchObject({
      attempts: 1,
      lastError: 'Not authorized.',
    })
    await discardGuardianAction(item.id)
    expect(await db.guardianActions.get(item.id)).toBeUndefined()
  })
})
