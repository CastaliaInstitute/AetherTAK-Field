import { useEffect, useState, type FormEvent } from 'react'
import { ClipboardCheck, Share2, Trash2 } from 'lucide-react'
import {
  clearInteroperabilitySession,
  createInteroperabilitySession,
  interoperabilityCapabilities,
  loadInteroperabilitySession,
  saveInteroperabilitySession,
  shareInteroperabilitySession,
  updateInteroperabilityLog,
  updateInteroperabilityResult,
  type InteroperabilityDirection,
  type InteroperabilityResult,
  type InteroperabilitySession,
} from '../interoperability/evidence'

interface InteroperabilityEvidencePanelProps {
  defaultSenderCallsign: string
}
const directions: {
  id: InteroperabilityDirection
  label: string
}[] = [
  { id: 'field_to_peer', label: 'Field → peer' },
  { id: 'peer_to_field', label: 'Peer → Field' },
]

function localDateTime(value: string | null) {
  return value ? value.slice(0, 16) : ''
}

function isoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null
}

export function InteroperabilityEvidencePanel({
  defaultSenderCallsign,
}: InteroperabilityEvidencePanelProps) {
  const [session, setSession] = useState<InteroperabilitySession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    void loadInteroperabilitySession()
      .then((value) => {
        if (!disposed) setSession(value)
      })
      .catch((cause) => {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'The saved interoperability session could not be loaded.',
          )
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [])

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = new FormData(event.currentTarget)
      const created = await createInteroperabilitySession({
        peerClient: data.get('peerClient') === 'ATAK' ? 'ATAK' : 'iTAK',
        peerVersion: String(data.get('peerVersion') ?? ''),
        peerDeviceModel: String(data.get('peerDeviceModel') ?? ''),
        peerOsVersion: String(data.get('peerOsVersion') ?? ''),
        serverVersion: String(data.get('serverVersion') ?? ''),
        senderCallsign: String(data.get('senderCallsign') ?? ''),
        recipientCallsign: String(data.get('recipientCallsign') ?? ''),
      })
      await saveInteroperabilitySession(created)
      setSession(created)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The interoperability session could not be created.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function commit(next: InteroperabilitySession) {
    setSession(next)
    try {
      await saveInteroperabilitySession(next)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The interoperability evidence could not be saved.',
      )
    }
  }

  function resultFor(
    capability: InteroperabilityResult['capability'],
    direction: InteroperabilityDirection,
  ) {
    return session?.results.find(
      (result) =>
        result.capability === capability && result.direction === direction,
    )
  }

  function updateResult(
    current: InteroperabilityResult,
    update: Partial<
      Pick<InteroperabilityResult, 'status' | 'evidenceReference' | 'notes'>
    >,
  ) {
    if (!session) return
    void commit(
      updateInteroperabilityResult(
        session,
        current.capability,
        current.direction,
        {
          status: update.status ?? current.status,
          evidenceReference:
            update.evidenceReference ?? current.evidenceReference,
          notes: update.notes ?? current.notes,
        },
      ),
    )
  }

  async function clear() {
    if (
      !window.confirm(
        'Delete this local interoperability test session? Export it first if it must be retained.',
      )
    ) return
    await clearInteroperabilitySession()
    setSession(null)
    setError(null)
  }

  if (loading) {
    return (
      <section className="interop-evidence" aria-label="TAK interoperability evidence">
        <p role="status">Loading physical-test evidence…</p>
      </section>
    )
  }

  if (!session) {
    return (
      <section className="interop-evidence" aria-labelledby="interop-heading">
        <div className="interop-heading">
          <ClipboardCheck size={21} />
          <div>
            <p className="eyebrow">PHYSICAL INTEROPERABILITY</p>
            <h3 id="interop-heading">iTAK / ATAK test session</h3>
          </div>
        </div>
        <p>
          Start one session per peer device. Results stay on this device until
          you explicitly export or delete them.
        </p>
        <form className="interop-start" onSubmit={(event) => void start(event)}>
          <label>
            <span>Peer client</span>
            <select name="peerClient" defaultValue="iTAK">
              <option>iTAK</option>
              <option>ATAK</option>
            </select>
          </label>
          <label><span>Peer version</span><input name="peerVersion" required maxLength={80} /></label>
          <label><span>Peer device</span><input name="peerDeviceModel" required maxLength={120} /></label>
          <label><span>Peer OS</span><input name="peerOsVersion" required maxLength={120} /></label>
          <label><span>TAK Server version</span><input name="serverVersion" required maxLength={120} /></label>
          <label><span>Field callsign</span><input name="senderCallsign" required maxLength={80} defaultValue={defaultSenderCallsign} /></label>
          <label><span>Peer callsign</span><input name="recipientCallsign" required maxLength={80} /></label>
          <button className="primary-action" type="submit" disabled={busy}>
            {busy ? 'Starting…' : 'Start physical test'}
          </button>
        </form>
        {error && <p className="tak-form-error" role="alert">{error}</p>}
      </section>
    )
  }

  const completed = session.results.filter(
    (result) => result.status !== 'pending',
  ).length

  return (
    <section className="interop-evidence" aria-labelledby="interop-heading">
      <div className="interop-heading">
        <ClipboardCheck size={21} />
        <div>
          <p className="eyebrow">PHYSICAL INTEROPERABILITY</p>
          <h3 id="interop-heading">
            {session.peer.client} {session.peer.version}
          </h3>
          <span>
            {completed}/{session.results.length} checks recorded · build{' '}
            {session.field.build} · {session.field.sourceRevision.slice(0, 7)}
          </span>
        </div>
      </div>

      <div className="interop-session-meta">
        <span>{session.field.deviceModel} / {session.field.osVersion}</span>
        <span>{session.peer.deviceModel} / {session.peer.osVersion}</span>
        <span>{session.senderCallsign} ↔ {session.recipientCallsign}</span>
      </div>

      <div className="interop-results">
        {interoperabilityCapabilities.map(([capability, label]) => (
          <details key={capability}>
            <summary>
              <strong>{label}</strong>
              <span>
                {directions.map(({ id }) => resultFor(capability, id)?.status)
                  .join(' / ')}
              </span>
            </summary>
            {directions.map(({ id, label: directionLabel }) => {
              const result = resultFor(capability, id)
              if (!result) return null
              return (
                <fieldset key={id}>
                  <legend>{directionLabel}</legend>
                  <label>
                    <span>Result</span>
                    <select
                      value={result.status}
                      onChange={(event) =>
                        updateResult(result, {
                          status: event.currentTarget
                            .value as InteroperabilityResult['status'],
                        })
                      }
                    >
                      <option value="pending">Pending</option>
                      <option value="pass">Pass</option>
                      <option value="fail">Fail</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </label>
                  <label>
                    <span>Screen evidence reference</span>
                    <input
                      value={result.evidenceReference}
                      maxLength={240}
                      placeholder="Controlled file or evidence ID"
                      onChange={(event) =>
                        updateResult(result, {
                          evidenceReference: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Notes</span>
                    <textarea
                      value={result.notes}
                      maxLength={500}
                      rows={2}
                      placeholder="Observed behavior; never paste chat content or coordinates"
                      onChange={(event) =>
                        updateResult(result, {
                          notes: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                </fieldset>
              )
            })}
          </details>
        ))}
      </div>

      <fieldset className="interop-log">
        <legend>Matching TAK Server log interval</legend>
        <label>
          <span>Starts</span>
          <input
            type="datetime-local"
            value={localDateTime(session.serverLogInterval.startsAt)}
            onChange={(event) =>
              void commit(updateInteroperabilityLog(session, {
                ...session.serverLogInterval,
                startsAt: isoDateTime(event.currentTarget.value),
              }))
            }
          />
        </label>
        <label>
          <span>Ends</span>
          <input
            type="datetime-local"
            value={localDateTime(session.serverLogInterval.endsAt)}
            onChange={(event) =>
              void commit(updateInteroperabilityLog(session, {
                ...session.serverLogInterval,
                endsAt: isoDateTime(event.currentTarget.value),
              }))
            }
          />
        </label>
        <label>
          <span>Controlled log reference</span>
          <input
            value={session.serverLogInterval.reference}
            maxLength={240}
            onChange={(event) =>
              void commit(updateInteroperabilityLog(session, {
                ...session.serverLogInterval,
                reference: event.currentTarget.value,
              }))
            }
          />
        </label>
      </fieldset>

      <p className="interop-privacy">
        Export excludes server addresses, coordinates, message content, and
        binary evidence. References must point to the controlled evidence store.
      </p>
      <div className="interop-actions">
        <button type="button" onClick={() => void shareInteroperabilitySession(session)}>
          <Share2 size={16} /> Export JSON
        </button>
        <button type="button" onClick={() => void clear()}>
          <Trash2 size={16} /> Delete session
        </button>
      </div>
      {error && <p className="tak-form-error" role="alert">{error}</p>}
    </section>
  )
}
