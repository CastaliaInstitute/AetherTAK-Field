import { useEffect, useState, type FormEvent } from 'react'
import { ClipboardCheck, Ruler, Share2, Trash2 } from 'lucide-react'
import {
  clearPhysicalReleaseSession,
  createPhysicalReleaseSession,
  loadPhysicalReleaseSession,
  physicalReleaseVerdict,
  physicalReleaseChecks,
  recordDepthAccuracy,
  savePhysicalReleaseSession,
  sharePhysicalReleaseSession,
  updatePhysicalReleaseResult,
  type PhysicalReleaseResult,
  type PhysicalReleaseSession,
} from '../release/evidence'

function resultRecorded(result: PhysicalReleaseResult) {
  if (result.status === 'pending') return false
  if (result.status === 'not_applicable') return result.notes.length > 0
  return result.evidenceReference.length > 0
}

export function PhysicalReleaseEvidencePanel() {
  const [session, setSession] = useState<PhysicalReleaseSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    void loadPhysicalReleaseSession()
      .then((value) => {
        if (!disposed) setSession(value)
      })
      .catch((cause) => {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'The saved physical release session could not be loaded.',
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
      const created = await createPhysicalReleaseSession(
        String(data.get('evidenceSetReference') ?? ''),
      )
      await savePhysicalReleaseSession(created)
      setSession(created)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The physical release session could not be created.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function commit(next: PhysicalReleaseSession) {
    setSession(next)
    try {
      await savePhysicalReleaseSession(next)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The physical release evidence could not be saved.',
      )
    }
  }

  function updateResult(
    current: PhysicalReleaseResult,
    update: Partial<
      Pick<PhysicalReleaseResult, 'status' | 'evidenceReference' | 'notes'>
    >,
  ) {
    if (!session) return
    void commit(
      updatePhysicalReleaseResult(session, current.check, {
        status: update.status ?? current.status,
        evidenceReference:
          update.evidenceReference ?? current.evidenceReference,
        notes: update.notes ?? current.notes,
      }),
    )
  }

  function recordDepth(
    event: FormEvent<HTMLFormElement>,
    result: PhysicalReleaseResult,
  ) {
    event.preventDefault()
    if (!session) return
    const data = new FormData(event.currentTarget)
    try {
      const next = recordDepthAccuracy(
        session,
        {
          knownDistanceMeters: Number(data.get('knownDistanceMeters')),
          measuredDistanceMeters: Number(data.get('measuredDistanceMeters')),
          tolerancePercent: Number(data.get('tolerancePercent')),
        },
        String(data.get('evidenceReference') ?? ''),
        String(data.get('notes') ?? ''),
      )
      void commit(next)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `The ${result.check} measurement could not be recorded.`,
      )
    }
  }

  async function clear() {
    if (
      !window.confirm(
        'Delete this local physical release session? Export it first if it must be retained.',
      )
    ) return
    await clearPhysicalReleaseSession()
    setSession(null)
    setError(null)
  }

  if (loading) {
    return (
      <section className="interop-evidence" aria-label="Physical release evidence">
        <p role="status">Loading physical release evidence…</p>
      </section>
    )
  }

  if (!session) {
    return (
      <section className="interop-evidence" aria-labelledby="physical-release-heading">
        <div className="interop-heading">
          <ClipboardCheck size={21} />
          <div>
            <p className="eyebrow">PHYSICAL RELEASE GATE</p>
            <h3 id="physical-release-heading">Device validation session</h3>
          </div>
        </div>
        <p>
          Start one session per release-candidate device. Use a controlled
          evidence-set ID, never a tester name or server address.
        </p>
        <form className="interop-start" onSubmit={(event) => void start(event)}>
          <label>
            <span>Controlled evidence-set reference</span>
            <input
              name="evidenceSetReference"
              required
              maxLength={240}
              placeholder="RC-0.2.0/ios-lidar-01"
            />
          </label>
          <button className="primary-action" type="submit" disabled={busy}>
            {busy ? 'Starting…' : 'Start device validation'}
          </button>
        </form>
        {error && <p className="tak-form-error" role="alert">{error}</p>}
      </section>
    )
  }

  const recorded = session.results.filter(resultRecorded).length
  const verdict = physicalReleaseVerdict(session)

  return (
    <section className="interop-evidence release-validation" aria-labelledby="physical-release-heading">
      <div className="interop-heading">
        <ClipboardCheck size={21} />
        <div>
          <p className="eyebrow">PHYSICAL RELEASE GATE</p>
          <h3 id="physical-release-heading">Device validation session</h3>
          <span>
            {recorded}/{session.results.length} checks evidenced · build{' '}
            {session.release.build} ·{' '}
            {session.release.sourceRevision.slice(0, 7)}
          </span>
        </div>
      </div>

      <div className="interop-session-meta">
        <span>
          {session.device.model} / {session.device.operatingSystem}{' '}
          {session.device.osVersion}
        </span>
        <span>{session.device.isVirtual ? 'Virtual device' : 'Physical device'}</span>
        <span>{session.evidenceSetReference}</span>
      </div>
      <p className={`release-verdict ${verdict}`} role="status">
        Release gate: {verdict}
        {verdict === 'attention'
          ? ' · companion-device evidence required'
          : verdict === 'fail'
            ? ' · do not promote this build'
            : ''}
      </p>

      <div className="interop-results">
        {physicalReleaseChecks.map(([check, label, instruction]) => {
          const result = session.results.find((item) => item.check === check)
          if (!result) return null
          return (
            <details key={check}>
              <summary>
                <strong>{label}</strong>
                <span>
                  {resultRecorded(result)
                    ? result.status.replace('_', ' ')
                    : 'pending'}
                </span>
              </summary>
              <p className="release-check-instruction">{instruction}</p>
              {check === 'depth_known_dimension' ? (
                <form
                  className="release-measurement"
                  onSubmit={(event) => recordDepth(event, result)}
                >
                  <label>
                    <span>Known distance (m)</span>
                    <input
                      name="knownDistanceMeters"
                      type="number"
                      min="0.001"
                      max="10000"
                      step="any"
                      required
                      defaultValue={
                        result.depthMeasurement?.knownDistanceMeters ?? ''
                      }
                    />
                  </label>
                  <label>
                    <span>Measured distance (m)</span>
                    <input
                      name="measuredDistanceMeters"
                      type="number"
                      min="0.001"
                      max="10000"
                      step="any"
                      required
                      defaultValue={
                        result.depthMeasurement?.measuredDistanceMeters ?? ''
                      }
                    />
                  </label>
                  <label>
                    <span>Accepted error (%)</span>
                    <input
                      name="tolerancePercent"
                      type="number"
                      min="0.01"
                      max="100"
                      step="any"
                      required
                      defaultValue={
                        result.depthMeasurement?.tolerancePercent ?? 5
                      }
                    />
                  </label>
                  <label>
                    <span>Measurement evidence reference</span>
                    <input
                      name="evidenceReference"
                      required
                      maxLength={240}
                      defaultValue={result.evidenceReference}
                    />
                  </label>
                  <label>
                    <span>Notes</span>
                    <textarea
                      name="notes"
                      maxLength={500}
                      rows={2}
                      defaultValue={result.notes}
                    />
                  </label>
                  {result.depthMeasurement && (
                    <p className={`depth-verdict ${result.status}`}>
                      <Ruler size={15} />
                      {result.depthMeasurement.absoluteErrorPercent.toFixed(2)}%
                      error · {result.status}
                    </p>
                  )}
                  <button type="submit">Evaluate measurement</button>
                </form>
              ) : (
                <fieldset>
                  <legend>{label} result</legend>
                  <label>
                    <span>Result</span>
                    <select
                      value={result.status}
                      onChange={(event) =>
                        updateResult(result, {
                          status: event.currentTarget
                            .value as PhysicalReleaseResult['status'],
                        })
                      }
                    >
                      <option value="pending">Pending</option>
                      <option value="pass">Pass</option>
                      <option value="fail">Fail</option>
                      <option value="blocked">Blocked</option>
                      <option value="not_applicable">Not applicable</option>
                    </select>
                  </label>
                  <label>
                    <span>Controlled evidence reference</span>
                    <input
                      value={result.evidenceReference}
                      maxLength={240}
                      placeholder="Screenshot, video, or log evidence ID"
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
                      placeholder={
                        result.status === 'not_applicable'
                          ? 'Required justification and companion-device session reference'
                          : 'Observed behavior without coordinates or record content'
                      }
                      onChange={(event) =>
                        updateResult(result, {
                          notes: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                </fieldset>
              )}
            </details>
          )
        })}
      </div>

      <p className="interop-privacy">
        Export contains controlled references, results, and derived measurement
        error. It excludes credentials, endpoints, coordinates, record/message
        content, media/log files, and personal tester identity.
      </p>
      <div className="interop-actions">
        <button type="button" onClick={() => void sharePhysicalReleaseSession(session)}>
          <Share2 size={16} /> Export JSON
        </button>
        <button type="button" onClick={() => void clear()}>
          <Trash2 size={16} /> Delete session
        </button>
      </div>
      {session.completedAt && (
        <p className="readiness-message" role="status">
          Every device gate has a result and required evidence reference.
          {verdict === 'pass'
            ? ' This physical-device session passes.'
            : ' Evidence completion does not satisfy release acceptance.'}
        </p>
      )}
      {error && <p className="tak-form-error" role="alert">{error}</p>}
    </section>
  )
}
