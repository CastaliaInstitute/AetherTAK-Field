import {
  GitCompareArrows,
  Server,
  ShieldAlert,
  Smartphone,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { OutboxItem } from '../data/database'
import type { FieldConflictResolution } from '../sync/fieldSync'

interface ConflictCenterProps {
  conflicts: OutboxItem[]
  onResolve: (
    outboxId: string,
    resolution: FieldConflictResolution,
  ) => Promise<unknown>
  onNotice: (message: string) => void
}

interface PendingResolution {
  outboxId: string
  resolution: FieldConflictResolution
}

function payloadLabel(payload: unknown, fallback: string) {
  if (typeof payload !== 'object' || payload === null) return fallback
  const record = payload as Record<string, unknown>
  for (const key of ['name', 'title', 'label']) {
    if (typeof record[key] === 'string' && record[key]) {
      return String(record[key])
    }
  }
  return fallback
}

function entityLabel(entityType: OutboxItem['entityType']) {
  return entityType.replaceAll('_', ' ')
}

export function ConflictCenter({
  conflicts,
  onResolve,
  onNotice,
}: ConflictCenterProps) {
  const [pending, setPending] = useState<PendingResolution | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = conflicts.filter((item) => item.conflict)

  if (visible.length === 0) return null

  async function resolve() {
    if (!pending) return
    const item = visible.find((candidate) => candidate.id === pending.outboxId)
    if (!item?.conflict) return
    setBusy(true)
    setError(null)
    try {
      await onResolve(item.id, pending.resolution)
      onNotice(
        pending.resolution === 'keep_device'
          ? `${entityLabel(item.entityType)} kept on this device and queued to overwrite the server.`
          : `${entityLabel(item.entityType)} replaced with the server version.`,
      )
      setPending(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The synchronization conflict could not be resolved.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="conflict-center" aria-label="Synchronization conflicts">
      <header>
        <ShieldAlert size={19} />
        <div>
          <p className="eyebrow">ACTION REQUIRED</p>
          <h3>{visible.length} synchronization conflict{visible.length === 1 ? '' : 's'}</h3>
        </div>
      </header>

      {visible.map((item) => {
        const current = item.conflict!
        const isPending = pending?.outboxId === item.id
        return (
          <article className="conflict-card" key={item.id}>
            <div className="conflict-title">
              <GitCompareArrows size={16} />
              <strong>{entityLabel(item.entityType)}</strong>
              <span>{item.entityId.slice(0, 8)}</span>
            </div>
            <div className="conflict-versions">
              <div>
                <Smartphone size={15} />
                <span><small>This device</small><strong>{payloadLabel(item.payload, 'Local deletion')}</strong></span>
              </div>
              <div>
                <Server size={15} />
                <span>
                  <small>Server · {current.author}</small>
                  <strong>{current.deleted ? 'Deleted on server' : payloadLabel(current.payload, 'Server record')}</strong>
                </span>
              </div>
            </div>
            <p className="conflict-time">
              Server revision {current.revision} · {new Date(current.updatedAt).toLocaleString()}
            </p>

            {isPending ? (
              <div className="conflict-confirm">
                <p>
                  {pending.resolution === 'keep_device'
                    ? 'Overwrite the current server record with this device’s version?'
                    : current.deleted
                      ? 'Accept the server deletion and discard this device’s pending edits?'
                      : 'Discard this device’s pending edits and use the server version?'}
                </p>
                <div>
                  <button type="button" disabled={busy} onClick={() => void resolve()}>
                    {busy ? 'Resolving…' : 'Confirm resolution'}
                  </button>
                  <button type="button" disabled={busy} aria-label="Cancel resolution" onClick={() => setPending(null)}>
                    <X size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="conflict-actions">
                <button
                  type="button"
                  onClick={() => setPending({ outboxId: item.id, resolution: 'keep_device' })}
                >
                  Keep this device
                </button>
                <button
                  type="button"
                  onClick={() => setPending({ outboxId: item.id, resolution: 'use_server' })}
                >
                  {current.deleted ? 'Accept deletion' : 'Use server'}
                </button>
              </div>
            )}
          </article>
        )
      })}
      {error && <p className="conflict-error" role="alert">{error}</p>}
    </section>
  )
}
