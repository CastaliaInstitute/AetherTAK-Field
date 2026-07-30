import { describe, expect, it, vi } from 'vitest'
import type { TakStatus } from '../platform/tak'
import {
  startTakSessionRecovery,
  type RecoveryListenerHandle,
} from './sessionRecovery'

const profile = {
  id: 'field-one',
  name: 'AetherTAK',
  host: 'tak.example.test',
  port: 8089,
  callsign: 'Field One',
  team: 'Green',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function harness(
  initial: TakStatus,
  overrides: Partial<{
    online: boolean
    connect: (profileId?: string) => Promise<TakStatus>
  }> = {},
) {
  let interval: (() => void) | null = null
  let onlineListener: (() => void) | null = null
  let resumeListener: ((active: boolean) => void) | null = null
  let statusListener: ((status: TakStatus) => void) | null = null
  const removed = { resume: false, status: false }
  const handle = (kind: keyof typeof removed): RecoveryListenerHandle => ({
    remove: async () => {
      removed[kind] = true
    },
  })
  const onStatus = vi.fn()
  const connect = vi.fn(
    overrides.connect ??
      (async () => ({
        ...initial,
        state: 'connected' as const,
        lastConnectedAt: '2026-07-30T15:00:00.000Z',
        error: null,
      })),
  )
  const stop = startTakSessionRecovery({
    intervalMs: 25,
    status: vi.fn(async () => initial),
    connect,
    onStatus,
    isOnline: () => overrides.online ?? true,
    setInterval: (callback) => {
      interval = callback
      return 7
    },
    clearInterval: vi.fn(),
    addOnlineListener: (callback) => {
      onlineListener = callback
    },
    removeOnlineListener: vi.fn(),
    addResumeListener: async (callback) => {
      resumeListener = callback
      return handle('resume')
    },
    addStatusListener: async (callback) => {
      statusListener = callback
      return handle('status')
    },
  })
  return {
    connect,
    interval: () => interval?.(),
    online: () => onlineListener?.(),
    resume: (active: boolean) => resumeListener?.(active),
    nativeStatus: (status: TakStatus) => statusListener?.(status),
    onStatus,
    removed,
    stop,
  }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('TAK session recovery', () => {
  it('connects an enrolled native session on launch', async () => {
    const recovery = harness({
      state: 'disconnected',
      profile,
      lastConnectedAt: null,
      error: null,
    })

    await settle()

    expect(recovery.connect).toHaveBeenCalledWith(profile.id)
    expect(recovery.onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'connected' }),
    )
    recovery.stop()
  })

  it('waits for connectivity before reconnecting', async () => {
    const recovery = harness(
      {
        state: 'disconnected',
        profile,
        lastConnectedAt: null,
        error: null,
      },
      { online: false },
    )

    await settle()

    expect(recovery.connect).not.toHaveBeenCalled()
    expect(recovery.onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'disconnected' }),
    )
    recovery.stop()
  })

  it('coalesces interval, online, and resume triggers', async () => {
    const pending = deferred<TakStatus>()
    const recovery = harness(
      {
        state: 'disconnected',
        profile,
        lastConnectedAt: null,
        error: null,
      },
      { connect: () => pending.promise },
    )
    await settle()

    recovery.interval()
    recovery.online()
    recovery.resume(true)
    await settle()

    expect(recovery.connect).toHaveBeenCalledTimes(1)
    pending.resolve({
      state: 'connected',
      profile,
      lastConnectedAt: '2026-07-30T15:00:00.000Z',
      error: null,
    })
    await settle()
    recovery.stop()
  })

  it('forwards native state changes and removes listeners', async () => {
    const recovery = harness({
      state: 'connected',
      profile,
      lastConnectedAt: '2026-07-30T15:00:00.000Z',
      error: null,
    })
    await settle()
    const disconnected: TakStatus = {
      state: 'disconnected',
      profile,
      lastConnectedAt: null,
      error: 'Network unavailable',
    }

    recovery.nativeStatus(disconnected)
    expect(recovery.onStatus).toHaveBeenLastCalledWith(disconnected)

    recovery.stop()
    await settle()
    expect(recovery.removed).toEqual({ resume: true, status: true })
  })
})
