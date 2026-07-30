import type { TakActivity } from './activity'

export function isTakActivityLive(
  activity: Pick<TakActivity, 'staleAt'>,
  now: number | Date = Date.now(),
) {
  const staleAt = Date.parse(activity.staleAt)
  const current = now instanceof Date ? now.getTime() : now
  return (
    Number.isFinite(staleAt) &&
    Number.isFinite(current) &&
    staleAt > current
  )
}

export function liveTakActivity(
  activity: TakActivity[],
  now: number | Date = Date.now(),
) {
  return activity.filter((item) => isTakActivityLive(item, now))
}
