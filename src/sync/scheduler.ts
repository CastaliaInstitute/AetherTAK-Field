export interface SyncSchedulerOptions {
  intervalMs?: number
  isOnline?: () => boolean
  setInterval?: (callback: () => void, intervalMs: number) => number
  clearInterval?: (id: number) => void
  addOnlineListener?: (callback: () => void) => void
  removeOnlineListener?: (callback: () => void) => void
}

export function startSyncScheduler(
  synchronize: () => Promise<unknown>,
  options: SyncSchedulerOptions = {},
) {
  const intervalMs = options.intervalMs ?? 30_000
  const isOnline = options.isOnline ?? (() => navigator.onLine)
  const schedule =
    options.setInterval ??
    ((callback, milliseconds) => window.setInterval(callback, milliseconds))
  const cancel =
    options.clearInterval ?? ((id) => window.clearInterval(id))
  const addOnlineListener =
    options.addOnlineListener ??
    ((callback) => window.addEventListener('online', callback))
  const removeOnlineListener =
    options.removeOnlineListener ??
    ((callback) => window.removeEventListener('online', callback))
  let disposed = false
  let running = false

  const run = async () => {
    if (disposed || running || !isOnline()) return
    running = true
    try {
      await synchronize()
    } finally {
      running = false
    }
  }
  const onOnline = () => void run()
  const timer = schedule(() => void run(), intervalMs)
  addOnlineListener(onOnline)
  void run()

  return () => {
    disposed = true
    cancel(timer)
    removeOnlineListener(onOnline)
  }
}
