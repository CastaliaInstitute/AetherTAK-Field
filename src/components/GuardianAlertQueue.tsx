import { useState } from 'react'
import {
  BellRing,
  Check,
  CircleCheck,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import type { GuardianActionOutbox } from '../data/database'
import type {
  GuardianAlert,
  GuardianParticipantState,
} from '../domain/models'

interface GuardianAlertQueueProps {
  alerts: GuardianAlert[]
  participants: GuardianParticipantState[]
  pendingActions: GuardianActionOutbox[]
  actionsEnabled: boolean
  onCheckIn: (participantId: string) => void
  onAcknowledge: (alertId: string) => void
  onResolve: (alertId: string, reason: string) => void
  onRetry: (actionId: string) => void
  onDiscard: (actionId: string) => void
}

const severityOrder: Record<GuardianAlert['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

function actionLabel(action: GuardianActionOutbox) {
  switch (action.kind) {
    case 'check_in':
      return 'Check-in'
    case 'acknowledge':
      return 'Acknowledgement'
    case 'resolve':
      return 'Resolution'
  }
}

export function GuardianAlertQueue({
  alerts,
  participants,
  pendingActions,
  actionsEnabled,
  onCheckIn,
  onAcknowledge,
  onResolve,
  onRetry,
  onDiscard,
}: GuardianAlertQueueProps) {
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const ordered = alerts
    .filter((alert) => alert.status !== 'resolved')
    .sort(
      (left, right) =>
        severityOrder[left.severity] - severityOrder[right.severity] ||
        left.openedAt.localeCompare(right.openedAt),
    )
  const participantName = (id: string) =>
    participants.find((participant) => participant.id === id)?.displayName ??
    'Guardian participant'
  const pendingFor = (kind: GuardianActionOutbox['kind'], targetId: string) =>
    pendingActions.some(
      (action) => action.kind === kind && action.targetId === targetId,
    )

  return (
    <section className="section-block guardian-alert-queue">
      <div className="section-title">
        <div>
          <p className="eyebrow">SAFETY WORKFLOW</p>
          <h2>Guardian alerts</h2>
        </div>
        <span className="guardian-alert-count">
          <BellRing size={16} />
          {ordered.length}
        </span>
      </div>
      {!actionsEnabled && (
        <p className="guardian-action-notice">
          Safety actions require the enrolled iOS or Android app.
        </p>
      )}
      <div className="guardian-checkins" aria-label="Participant check-ins">
        {participants.map((participant) => {
          const pending = pendingFor('check_in', participant.id)
          return (
            <button
              type="button"
              key={participant.id}
              disabled={!actionsEnabled || pending}
              onClick={() => onCheckIn(participant.id)}
            >
              <CircleCheck size={15} />
              {pending
                ? `${participant.displayName} check-in queued`
                : `Check in ${participant.displayName}`}
            </button>
          )
        })}
      </div>
      {ordered.length === 0 ? (
        <p className="guardian-empty">No active Guardian alerts.</p>
      ) : (
        <div className="guardian-alert-list">
          {ordered.map((alert) => {
            const acknowledgementPending = pendingFor(
              'acknowledge',
              alert.id,
            )
            const resolutionPending = pendingFor('resolve', alert.id)
            const reason = reasons[alert.id] ?? ''
            return (
              <article
                className={`guardian-alert-card ${alert.severity}`}
                key={alert.id}
              >
                <span className="guardian-alert-status">
                  {alert.severity} · {alert.status}
                </span>
                <h3>{alert.title}</h3>
                <p>
                  {participantName(alert.participantId)} · {alert.detail}
                </p>
                <div className="guardian-alert-actions">
                  {alert.status === 'active' && (
                    <button
                      type="button"
                      disabled={
                        !actionsEnabled || acknowledgementPending
                      }
                      onClick={() => onAcknowledge(alert.id)}
                    >
                      <Check size={15} />
                      {acknowledgementPending
                        ? 'Acknowledgement queued'
                        : 'Acknowledge'}
                    </button>
                  )}
                  <label>
                    Resolution reason
                    <textarea
                      value={reason}
                      maxLength={500}
                      disabled={!actionsEnabled || resolutionPending}
                      onChange={(event) =>
                        setReasons((current) => ({
                          ...current,
                          [alert.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      !actionsEnabled ||
                      resolutionPending ||
                      reason.trim().length < 3
                    }
                    onClick={() => onResolve(alert.id, reason.trim())}
                  >
                    <CircleCheck size={15} />
                    {resolutionPending
                      ? 'Resolution queued'
                      : 'Resolve as safe'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {pendingActions.length > 0 && (
        <div className="guardian-pending-actions">
          <h3>Pending safety actions</h3>
          {pendingActions.map((action) => (
            <article key={action.id}>
              <div>
                <strong>{actionLabel(action)}</strong>
                <span>
                  {action.lastError
                    ? action.lastError
                    : 'Queued for authenticated delivery'}
                </span>
              </div>
              {action.lastError && (
                <>
                  <button
                    type="button"
                    aria-label={`Retry ${actionLabel(action)}`}
                    onClick={() => onRetry(action.id)}
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Discard ${actionLabel(action)}`}
                    onClick={() => onDiscard(action.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
