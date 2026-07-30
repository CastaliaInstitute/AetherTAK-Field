import type { TakStatus } from '../platform/tak'

export interface RecoveryListenerHandle {
  remove(): Promise<void>
}

export interface TakSessionRecoveryOptions {
  intervalMs?: number
  status(): Promise<TakStatus>
  connect(profileId?: string): Promise<TakStatus>
  onStatus(status: TakStatus): void
  isOnline(): boolean
  setInterval(callback: () => void, intervalMs: number): number
  clearInterval(id: number): void
  addOnlineListener(callback: () => void): void
  removeOnlineListener(callback: () => void): void
  addResumeListener(
    callback: (active: boolean) => void,
  ): Promise<RecoveryListenerHandle | null>
  addStatusListener(
    callback: (status: TakStatus) => void,
  ): Promise<RecoveryListenerHandle | null>
}

export function startTakSessionRecovery(options: TakSessionRecoveryOptions) {
  const intervalMs = options.intervalMs ?? 15_000
  let disposed = false
  let running = false
  let resumeHandle: RecoveryListenerHandle | null = null
  let statusHandle: RecoveryListenerHandle | null = null

  const publish = (status: TakStatus) => {
    if (!disposed) options.onStatus(status)
  }

  const reconcile = async () => {
    if (disposed || running) return
    running = true
    try {
      let current = await options.status()
      if (
        current.state === 'disconnected' &&
        current.profile &&
        options.isOnline()
      ) {
        current = await options.connect(current.profile.id)
      }
      publish(current)
    } catch {
      // Native status/connect errors are retried by the next bounded trigger.
    } finally {
      running = false
    }
  }

  const onOnline = () => void reconcile()
  options.addOnlineListener(onOnline)
  const timer = options.setInterval(() => void reconcile(), intervalMs)

  void options.addResumeListener((active) => {
    if (active) void reconcile()
  }).then((handle) => {
    if (disposed) {
      if (handle) void handle.remove()
    } else {
      resumeHandle = handle
    }
  })

  void options.addStatusListener(publish).then((handle) => {
    if (disposed) {
      if (handle) void handle.remove()
    } else {
      statusHandle = handle
    }
  })

  void reconcile()

  return () => {
    disposed = true
    options.clearInterval(timer)
    options.removeOnlineListener(onOnline)
    if (resumeHandle) void resumeHandle.remove()
    if (statusHandle) void statusHandle.remove()
  }
}
