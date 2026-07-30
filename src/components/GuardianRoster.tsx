import { Battery, MapPin, ShieldAlert, Users } from 'lucide-react'
import type { GuardianParticipantState } from '../domain/models'

interface GuardianRosterProps {
  participants: GuardianParticipantState[]
  now: Date
}

const urgency: Record<GuardianParticipantState['state'], number> = {
  critical: 0,
  caution: 1,
  offline: 2,
  normal: 3,
}

function sourceLabel(source: GuardianParticipantState['location']['source']) {
  return {
    watch_gnss: 'Watch GPS',
    ble_estimate: 'BLE estimate',
    ble_presence: 'BLE zone',
    meshtastic: 'Meshtastic',
    last_known: 'Last known',
  }[source]
}

function contactAge(lastContactAt: string, now: Date) {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(lastContactAt).getTime()) / 1_000),
  )
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export function GuardianRoster({
  participants,
  now,
}: GuardianRosterProps) {
  const ordered = [...participants].sort(
    (left, right) =>
      urgency[left.state] - urgency[right.state] ||
      left.displayName.localeCompare(right.displayName),
  )

  return (
    <section className="section-block guardian-roster">
      <div className="section-title">
        <div>
          <p className="eyebrow">CASTALIA GUARDIAN</p>
          <h2>People safety</h2>
        </div>
        <span className="guardian-count">
          <Users size={16} />
          {participants.length}
        </span>
      </div>
      {ordered.length === 0 ? (
        <p className="guardian-empty">
          No Guardian participant state has synchronized to this device.
        </p>
      ) : (
        <div className="guardian-list">
          {ordered.map((participant) => (
            <article
              className={`guardian-person ${participant.state}`}
              key={participant.id}
            >
              <div className="guardian-person-heading">
                <div>
                  <span className="guardian-state">{participant.state}</span>
                  <h3>{participant.displayName}</h3>
                </div>
                {participant.alertState !== 'none' && (
                  <span className={`guardian-alert ${participant.alertState}`}>
                    <ShieldAlert size={15} />
                    {participant.alertState}
                  </span>
                )}
              </div>
              <p>
                <MapPin size={14} />
                {participant.zone ?? 'No named zone'} ·{' '}
                {sourceLabel(participant.location.source)} ·{' '}
                {participant.location.confidence}
              </p>
              <p>
                <Battery size={14} />
                {participant.device.batteryPercent === null
                  ? 'Battery unavailable'
                  : `${Math.round(participant.device.batteryPercent)}% battery`}
                {' · '}
                Contact {contactAge(participant.device.lastContactAt, now)}
                {participant.checkIn === 'not_required'
                  ? ''
                  : ` · ${participant.checkIn.replaceAll('_', ' ')} check-in`}
              </p>
            </article>
          ))}
        </div>
      )}
      <p className="guardian-context">
        Location and device status are contextual safety information. Guardian
        does not provide medical diagnosis.
      </p>
    </section>
  )
}
