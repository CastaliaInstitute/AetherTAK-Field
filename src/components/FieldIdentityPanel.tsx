import { useState } from 'react'
import { BadgeCheck, RefreshCw } from 'lucide-react'
import {
  fieldApiTransport,
  type FieldIdentity,
} from '../platform/tak'

interface FieldIdentityPanelProps {
  verify?: () => Promise<FieldIdentity>
}

function roleLabels(identity: FieldIdentity) {
  const roles: string[] = []
  if (identity.permissions.guardianSupervisor) {
    roles.push('Guardian supervisor')
  } else if (identity.permissions.guardianCheckIn) {
    roles.push('Guardian check-in')
  }
  if (identity.permissions.publisher) roles.push('Field publisher')
  return roles.length > 0 ? roles : ['No privileged Field role']
}

export function FieldIdentityPanel({
  verify = () => fieldApiTransport.identity(),
}: FieldIdentityPanelProps) {
  const [identity, setIdentity] = useState<FieldIdentity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verifyIdentity = async () => {
    setBusy(true)
    setError(null)
    try {
      setIdentity(await verify())
    } catch (reason) {
      setIdentity(null)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Field identity verification failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="field-identity-panel" aria-label="Field API identity">
      <div>
        <p className="eyebrow">MUTUAL TLS IDENTITY</p>
        <h3>Field authorization</h3>
      </div>
      <button type="button" disabled={busy} onClick={verifyIdentity}>
        <RefreshCw size={15} />
        {busy ? 'Verifying…' : 'Verify certificate role'}
      </button>
      {identity && (
        <div className="field-identity-result" role="status">
          <BadgeCheck size={19} />
          <div>
            <strong>{identity.commonName}</strong>
            <span>{roleLabels(identity).join(' · ')}</span>
          </div>
        </div>
      )}
      {error && <p className="field-identity-error" role="alert">{error}</p>}
      <p className="field-identity-privacy">
        Only the certificate common name and effective roles are returned.
        Certificate and private-key material remain native.
      </p>
    </section>
  )
}
