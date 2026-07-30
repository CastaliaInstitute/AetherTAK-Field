import { describe, expect, it, vi } from 'vitest'
import { startSyncScheduler } from './scheduler'

describe('connected field synchronization scheduler', () => {
  it('runs immediately, periodically, and when connectivity returns', async () => {
    let interval: (() => void) | undefined
    let online: (() => void) | undefined
    const synchronize = vi.fn(async () => undefined)
    const stop = startSyncScheduler(synchronize, {
      isOnline: () => true,
      setInterval: (callback, milliseconds) => {
        expect(milliseconds).toBe(30_000)
        interval = callback
        return 7
      },
      clearInterval: vi.fn(),
      addOnlineListener: (callback) => {
        online = callback
      },
      removeOnlineListener: vi.fn(),
    })
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(1))

    interval?.()
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(2))
    online?.()
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(3))
    stop()
  })

  it('skips offline ticks and never overlaps synchronization', async () => {
    let interval: (() => void) | undefined
    let online = false
    let release: (() => void) | undefined
    const synchronize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    startSyncScheduler(synchronize, {
      isOnline: () => online,
      setInterval: (callback) => {
        interval = callback
        return 8
      },
      clearInterval: vi.fn(),
      addOnlineListener: vi.fn(),
      removeOnlineListener: vi.fn(),
    })
    expect(synchronize).not.toHaveBeenCalled()

    online = true
    interval?.()
    interval?.()
    expect(synchronize).toHaveBeenCalledTimes(1)
    release?.()
    await Promise.resolve()
    interval?.()
    expect(synchronize).toHaveBeenCalledTimes(2)
  })
})
