import {
  Box,
  CalendarClock,
  Camera,
  FileWarning,
  MapPin,
  ScanLine,
  Share2,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  EcologicalSite,
  Field,
  MediaCapture,
  Observation,
} from '../domain/models'
import {
  artifactLabel,
  mediaDisplayUri,
  observationArtifacts,
} from '../media/mediaDisplay'
import { artifactSharing } from '../media/artifactSharing'

interface ObservationDetailProps {
  observation: Observation
  media: MediaCapture[]
  fields: Field[]
  ecologicalSites: EcologicalSite[]
  onClose: () => void
}

function assignmentLabel(
  observation: Observation,
  fields: Field[],
  ecologicalSites: EcologicalSite[],
) {
  if (observation.fieldId) {
    const field = fields.find((item) => item.id === observation.fieldId)
    return field ? `${field.cropIcon} ${field.name}` : 'Deleted crop field'
  }
  if (observation.siteId) {
    const site = ecologicalSites.find((item) => item.id === observation.siteId)
    return site ? `🌿 ${site.name}` : 'Deleted ecological site'
  }
  return 'Unassigned location'
}

function ArtifactIcon({ kind }: { kind: MediaCapture['kind'] }) {
  if (kind === 'photo') return <Camera size={17} />
  if (kind === 'video') return <Video size={17} />
  if (kind === 'model' || kind === 'point_cloud') return <Box size={17} />
  return <ScanLine size={17} />
}

function ArtifactPreview({ artifact }: { artifact: MediaCapture }) {
  const preview = mediaDisplayUri(artifact.previewUri)
  const source = mediaDisplayUri(artifact.localUri)

  if (artifact.kind === 'video' && source) {
    return (
      <video
        aria-label="Observation video"
        controls
        playsInline
        preload="metadata"
        poster={preview ?? undefined}
        src={source}
      />
    )
  }
  if ((artifact.kind === 'photo' || preview) && (preview ?? source)) {
    return (
      <img
        alt={`${artifactLabel(artifact.kind)} observation preview`}
        loading="lazy"
        src={(preview ?? source) ?? undefined}
      />
    )
  }
  return (
    <div className="artifact-no-preview">
      <ArtifactIcon kind={artifact.kind} />
      <span>Stored offline · preview unavailable</span>
    </div>
  )
}

export function ObservationDetail({
  observation,
  media,
  fields,
  ecologicalSites,
  onClose,
}: ObservationDetailProps) {
  const artifacts = observationArtifacts(observation, media)
  const coordinate = observation.coordinate
  const closeButton = useRef<HTMLButtonElement>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)

  useEffect(() => {
    closeButton.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  async function shareArtifact(artifact: MediaCapture) {
    setSharingId(artifact.id)
    setShareError(null)
    try {
      await artifactSharing.share(artifact, observation)
    } catch (error) {
      setShareError(
        error instanceof Error
          ? error.message
          : 'This evidence could not be opened or shared.',
      )
    } finally {
      setSharingId(null)
    }
  }

  return (
    <div
      className="observation-detail-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label={`Observation ${observation.title}`}
        aria-modal="true"
        className="observation-detail"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">{observation.category} observation</p>
            <h3>{observation.title}</h3>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close observation"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>

        <div className="observation-context">
          <p><MapPin size={15} /> {assignmentLabel(observation, fields, ecologicalSites)}</p>
          <p>
            <CalendarClock size={15} />
            {new Date(observation.observedAt).toLocaleString()}
          </p>
        </div>

        {observation.notes && <p className="observation-notes">{observation.notes}</p>}

        <dl className="observation-location">
          <div><dt>Latitude</dt><dd>{coordinate.latitude.toFixed(6)}</dd></div>
          <div><dt>Longitude</dt><dd>{coordinate.longitude.toFixed(6)}</dd></div>
          <div><dt>Horizontal accuracy</dt><dd>{coordinate.horizontalAccuracyMeters === null ? '—' : `±${coordinate.horizontalAccuracyMeters.toFixed(1)} m`}</dd></div>
          <div><dt>Altitude</dt><dd>{coordinate.altitudeMeters === null ? '—' : `${coordinate.altitudeMeters.toFixed(1)} m`}</dd></div>
          <div><dt>Sync state</dt><dd>{observation.syncState}</dd></div>
        </dl>

        <div className="observation-artifacts-heading">
          <strong>Evidence</strong>
          <span>{artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}</span>
        </div>

        <div className="observation-artifacts">
          {artifacts.length === 0 && (
            <p className="records-muted">This observation has no media artifacts.</p>
          )}
          {artifacts.map(({ id, media: artifact }) =>
            artifact ? (
              <article className="observation-artifact" key={id}>
                <div className="artifact-heading">
                  <span><ArtifactIcon kind={artifact.kind} /> {artifactLabel(artifact.kind)}</span>
                  <small>{artifact.syncState}</small>
                </div>
                <ArtifactPreview artifact={artifact} />
                {artifact.depthMetadata && (
                  <div className="depth-evidence">
                    <p>{artifact.depthMetadata.provider} · {artifact.depthMetadata.role.replaceAll('_', ' ')}</p>
                    {artifact.depthMetadata.measurements.map((measurement) => (
                      <dl key={`${artifact.id}:${measurement.label}`}>
                        <dt>{measurement.label}</dt>
                        <dd>
                          {measurement.value.toFixed(2)} {measurement.unit}
                          {measurement.uncertainty !== null
                            ? ` ±${measurement.uncertainty.toFixed(2)}`
                            : ''}
                        </dd>
                      </dl>
                    ))}
                  </div>
                )}
                {artifact.cameraCaptureEvidence && (
                  <div className="artifact-integrity">
                    {artifact.cameraCaptureEvidence.durationSeconds !== null && (
                      <span>
                        {artifact.cameraCaptureEvidence.durationSeconds.toFixed(1)} s
                      </span>
                    )}
                    {artifact.cameraCaptureEvidence.widthPixels !== null &&
                      artifact.cameraCaptureEvidence.heightPixels !== null && (
                        <span>
                          {artifact.cameraCaptureEvidence.widthPixels}×
                          {artifact.cameraCaptureEvidence.heightPixels}
                        </span>
                      )}
                    {artifact.cameraCaptureEvidence.sizeBytes !== null && (
                      <span>
                        {(artifact.cameraCaptureEvidence.sizeBytes / 1_048_576).toFixed(1)} MB
                      </span>
                    )}
                    <span>
                      Location fix{' '}
                      {new Date(
                        artifact.cameraCaptureEvidence.locationObservedAt,
                      ).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                <div className="artifact-integrity">
                  <span>{artifact.mimeType}</span>
                  <span>{artifact.deviceModel ?? 'Hardware not reported'}</span>
                  <span>{artifact.sha256 ? `SHA-256 ${artifact.sha256.slice(0, 12)}…` : 'Checksum pending'}</span>
                </div>
                {artifactSharing.canShare(artifact) && (
                  <button
                    className="artifact-share"
                    type="button"
                    disabled={sharingId !== null}
                    onClick={() => void shareArtifact(artifact)}
                  >
                    <Share2 size={15} />
                    {sharingId === artifact.id
                      ? 'Opening share sheet…'
                      : `Open or share ${artifactLabel(artifact.kind).toLowerCase()}`}
                  </button>
                )}
              </article>
            ) : (
              <article className="observation-artifact missing" key={id}>
                <FileWarning size={20} />
                <div>
                  <strong>Artifact unavailable</strong>
                  <p>The record is present, but this device has not downloaded its media yet.</p>
                </div>
              </article>
            ),
          )}
        </div>
        {shareError && (
          <p className="capture-error artifact-share-error" role="alert">
            {shareError}
          </p>
        )}
      </section>
    </div>
  )
}
