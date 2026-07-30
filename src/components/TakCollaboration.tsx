import { useEffect, useState, type FormEvent } from 'react'
import {
  LocateFixed,
  MapPin,
  MessageCircle,
  Pentagon,
  Route,
  Send,
  Siren,
  Undo2,
  Users,
  X,
} from 'lucide-react'
import type { BackgroundTrackingStatus } from '../platform/tak'
import type { TakContact } from '../domain/models'
import type { TakActivity } from '../tak/activity'
import type {
  EmergencyOperation,
  TakOperationKind,
} from '../tak/operations'

export interface TakMapDraft {
  kind: 'marker' | 'route' | 'shape'
  pointCount: number
}

interface TakTrackingControlProps {
  status: BackgroundTrackingStatus
  busy: boolean
  connected: boolean
  onToggle: () => Promise<void>
}

export function TakTrackingControl({
  status,
  busy,
  connected,
  onToggle,
}: TakTrackingControlProps) {
  if (!status.supported) return null
  return (
    <section className="tak-tracking-control" aria-label="Background team tracking">
      <div>
        <LocateFixed size={19} />
        <div>
          <strong>Background team location</strong>
          <span>
            Shares a stale-bounded TAK position every 15 seconds while moving.
            Your phone shows a system indicator whenever this is active.
          </span>
        </div>
      </div>
      <button
        type="button"
        aria-pressed={status.enabled}
        disabled={busy || (!connected && !status.enabled)}
        onClick={() => void onToggle()}
      >
        {busy
          ? 'Updating…'
          : status.enabled
            ? 'Stop background sharing'
            : 'Share in background'}
      </button>
      <small>{status.detail}</small>
    </section>
  )
}

interface TakMapComposerProps {
  draft: TakMapDraft | null
  onStart: (kind: TakMapDraft['kind']) => void
  onUndo: () => void
  onCancel: () => void
  onSubmit: (title: string, remarks: string) => Promise<void>
}

const mapActions = [
  { kind: 'marker' as const, label: 'Marker', icon: MapPin },
  { kind: 'route' as const, label: 'Route', icon: Route },
  { kind: 'shape' as const, label: 'Area', icon: Pentagon },
]

export function TakMapComposer({
  draft,
  onStart,
  onUndo,
  onCancel,
  onSubmit,
}: TakMapComposerProps) {
  const [title, setTitle] = useState('')
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTitle('')
    setRemarks('')
    setError(null)
  }, [draft?.kind])

  const minimum =
    draft?.kind === 'marker' ? 1 : draft?.kind === 'route' ? 2 : 3

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft || !title.trim() || draft.pointCount < minimum) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(title.trim(), remarks.trim())
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The TAK map item could not be queued.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="tak-map-composer" aria-label="TAK map tools">
      {!draft ? (
        <div className="tak-map-actions">
          {mapActions.map(({ kind, label, icon: Icon }) => (
            <button key={kind} type="button" onClick={() => onStart(kind)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <div className="tak-draft-heading">
            <div>
              <strong>New {draft.kind}</strong>
              <span>
                Tap the map · {draft.pointCount} point
                {draft.pointCount === 1 ? '' : 's'}
              </span>
            </div>
            <button type="button" aria-label="Cancel map item" onClick={onCancel}>
              <X size={18} />
            </button>
          </div>
          <label>
            <span>Name</span>
            <input
              value={title}
              maxLength={80}
              placeholder={
                draft.kind === 'marker'
                  ? 'Dry patch'
                  : draft.kind === 'route'
                    ? 'Irrigation walk'
                    : 'Treatment area'
              }
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
          {draft.kind === 'marker' && (
            <label>
              <span>Remarks</span>
              <input
                value={remarks}
                maxLength={240}
                placeholder="Optional field note"
                onChange={(event) => setRemarks(event.currentTarget.value)}
              />
            </label>
          )}
          <div className="tak-draft-actions">
            <button
              type="button"
              disabled={draft.pointCount === 0}
              onClick={onUndo}
            >
              <Undo2 size={15} /> Undo
            </button>
            <button
              className="send"
              type="submit"
              disabled={
                submitting ||
                !title.trim() ||
                draft.pointCount < minimum
              }
            >
              <Send size={15} />
              {submitting ? 'Queueing…' : 'Send to TAK'}
            </button>
          </div>
          {error && <p className="tak-form-error" role="alert">{error}</p>}
        </form>
      )}
    </section>
  )
}

interface TakTeamPanelProps {
  callsign: string
  contacts: TakContact[]
  activity: TakActivity[]
  queuedCount: number
  onSendChat: (contact: TakContact, message: string) => Promise<void>
  onSendEmergency: (
    type: EmergencyOperation['emergencyType'],
  ) => Promise<void>
}

const emergencyTypes: EmergencyOperation['emergencyType'][] = [
  'Medical',
  '911 Alert',
  'In Contact',
  'Geo-fence Breached',
  'Ring The Bell',
]

function activityLabel(kind: TakOperationKind) {
  return kind === 'shape' ? 'area' : kind
}

export function TakTeamPanel({
  callsign,
  contacts,
  activity,
  queuedCount,
  onSendChat,
  onSendEmergency,
}: TakTeamPanelProps) {
  const [chatContact, setChatContact] = useState<TakContact | null>(null)
  const [message, setMessage] = useState('')
  const [emergency, setEmergency] =
    useState<EmergencyOperation['emergencyType'] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [emergencyError, setEmergencyError] = useState<string | null>(null)

  async function sendChat(event: FormEvent) {
    event.preventDefault()
    if (!chatContact || !message.trim()) return
    setSubmitting(true)
    setChatError(null)
    try {
      await onSendChat(chatContact, message.trim())
      setMessage('')
      setChatContact(null)
    } catch (cause) {
      setChatError(
        cause instanceof Error ? cause.message : 'The GeoChat message could not be queued.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function sendEmergency() {
    if (!emergency) return
    setSubmitting(true)
    setEmergencyError(null)
    try {
      await onSendEmergency(emergency)
      setEmergency(null)
    } catch (cause) {
      setEmergencyError(
        cause instanceof Error ? cause.message : 'The emergency signal could not be sent.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const latestEmergency = activity.find(
    (item) => item.direction === 'outbound' && item.kind === 'emergency',
  )
  const hasActiveEmergency =
    latestEmergency !== undefined && latestEmergency.title !== 'Cancel'

  async function cancelEmergency() {
    setSubmitting(true)
    setEmergencyError(null)
    try {
      await onSendEmergency('Cancel')
    } catch (cause) {
      setEmergencyError(
        cause instanceof Error ? cause.message : 'The emergency cancellation could not be sent.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="tak-team-summary">
        <div>
          <Users size={18} />
          <span>
            <strong>{contacts.length}</strong> active contacts
          </span>
        </div>
        <span>{queuedCount ? `${queuedCount} queued` : 'Outbox clear'}</span>
      </section>

      <section className="tak-emergency-panel" aria-label="Emergency signaling">
        <div>
          <Siren size={20} />
          <div>
            <strong>Emergency signal</strong>
            <span>Broadcast with your current location</span>
          </div>
        </div>
        {!emergency ? (
          <div className="tak-emergency-entry">
            <button type="button" onClick={() => setEmergency('Medical')}>
              Choose signal
            </button>
            {hasActiveEmergency && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void cancelEmergency()}
              >
                Cancel active signal
              </button>
            )}
          </div>
        ) : (
          <div className="tak-emergency-confirm">
            <label>
              <span>Emergency type</span>
              <select
                value={emergency}
                onChange={(event) =>
                  setEmergency(
                    event.currentTarget
                      .value as EmergencyOperation['emergencyType'],
                  )
                }
              >
                {emergencyTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <p>
              This sends an active TAK emergency as <strong>{callsign}</strong>.
            </p>
            <div>
              <button type="button" onClick={() => setEmergency(null)}>
                Cancel
              </button>
              <button
                className="emergency-send"
                type="button"
                disabled={submitting}
                onClick={() => void sendEmergency()}
              >
                <Siren size={16} /> Send {emergency}
              </button>
            </div>
          </div>
        )}
        {emergencyError && (
          <p className="tak-form-error" role="alert">{emergencyError}</p>
        )}
      </section>

      <section aria-labelledby="tak-contact-heading">
        <div className="tak-section-heading">
          <div>
            <p className="eyebrow">LIVE TAK NETWORK</p>
            <h3 id="tak-contact-heading">Contacts</h3>
          </div>
        </div>
        {contacts.length === 0 && (
          <p className="tak-empty">No non-stale TAK contacts are currently visible.</p>
        )}
        {contacts.map((contact) => (
          <article className="record-row tak-contact-row" key={contact.uid}>
            <span className="team-avatar">
              {contact.callsign.slice(0, 2)}
            </span>
            <div>
              <strong>{contact.callsign}</strong>
              <p>{contact.team ?? 'No team'} · active</p>
            </div>
            <button
              type="button"
              aria-label={`Message ${contact.callsign}`}
              onClick={() => setChatContact(contact)}
            >
              <MessageCircle size={19} />
            </button>
          </article>
        ))}
      </section>

      {chatContact && (
        <form className="tak-chat-composer" onSubmit={(event) => void sendChat(event)}>
          <div>
            <strong>Message {chatContact.callsign}</strong>
            <button
              type="button"
              aria-label="Close message composer"
              onClick={() => setChatContact(null)}
            >
              <X size={18} />
            </button>
          </div>
          <textarea
            autoFocus
            value={message}
            maxLength={1_000}
            rows={3}
            aria-label={`Message to ${chatContact.callsign}`}
            placeholder="Type a TAK GeoChat message"
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
          <button
            className="primary-action"
            type="submit"
            disabled={submitting || !message.trim()}
          >
            <Send size={17} /> Send GeoChat
          </button>
          {chatError && (
            <p className="tak-form-error" role="alert">{chatError}</p>
          )}
        </form>
      )}

      <section className="tak-activity" aria-labelledby="tak-activity-heading">
        <div className="tak-section-heading">
          <div>
            <p className="eyebrow">DURABLE ACTIVITY</p>
            <h3 id="tak-activity-heading">Recent TAK events</h3>
          </div>
        </div>
        {activity.length === 0 && (
          <p className="tak-empty">Messages and map events will appear here.</p>
        )}
        {activity.slice(0, 30).map((item) => (
          <article key={item.id} className="tak-activity-row">
            <span className={`tak-kind ${item.kind}`}>
              {activityLabel(item.kind)}
            </span>
            <div>
              <strong>{item.title}</strong>
              {item.message && <p>{item.message}</p>}
            </div>
            <span className={`delivery ${item.deliveryStatus}`}>
              {item.deliveryStatus}
            </span>
          </article>
        ))}
      </section>
    </>
  )
}
