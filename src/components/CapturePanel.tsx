import { useState } from 'react'
import {
  Camera,
  Database,
  MapPin,
  ScanLine,
  Video,
} from 'lucide-react'
import type {
  DepthCapability,
  EcologicalSite,
  Field,
  Observation,
} from '../domain/models'
import type { DepthScanMode } from '../media/depthObservation'
import type { ObservationCaptureInput } from '../media/observationCapture'

type CaptureKind = 'photo' | 'video' | 'depth'

interface CapturePanelProps {
  fields: Field[]
  ecologicalSites: EcologicalSite[]
  depth: DepthCapability
  onPhoto: (input: ObservationCaptureInput) => Promise<void>
  onVideo: (input: ObservationCaptureInput) => Promise<void>
  onDepth: (
    input: ObservationCaptureInput,
    mode: DepthScanMode,
  ) => Promise<void>
}

const categories: Array<{
  value: Observation['category']
  label: string
}> = [
  { value: 'crop', label: 'Crop' },
  { value: 'species', label: 'Species' },
  { value: 'habitat', label: 'Habitat' },
  { value: 'water', label: 'Water' },
  { value: 'soil', label: 'Soil' },
  { value: 'damage', label: 'Damage' },
]

function assignment(value: string) {
  if (value.startsWith('field:')) {
    return { fieldId: value.slice('field:'.length), siteId: null }
  }
  if (value.startsWith('site:')) {
    return { fieldId: null, siteId: value.slice('site:'.length) }
  }
  return { fieldId: null, siteId: null }
}

export function CapturePanel({
  fields,
  ecologicalSites,
  depth,
  onPhoto,
  onVideo,
  onDepth,
}: CapturePanelProps) {
  const [target, setTarget] = useState('')
  const [category, setCategory] =
    useState<Observation['category']>('crop')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [depthMode, setDepthMode] = useState<DepthScanMode>(
    depth.supportsMesh
      ? 'mesh'
      : depth.supportsPointCloud
        ? 'point_cloud'
        : 'measure',
  )
  const [busy, setBusy] = useState<CaptureKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function capture(kind: CaptureKind) {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Give this observation a title before capturing evidence.')
      return
    }
    const input: ObservationCaptureInput = {
      ...assignment(target),
      category,
      title: trimmedTitle,
      notes: notes.trim(),
    }
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'photo') await onPhoto(input)
      if (kind === 'video') await onVideo(input)
      if (kind === 'depth') await onDepth(input, depthMode)
      setTitle('')
      setNotes('')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Evidence capture failed.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="capture-panel">
      <header>
        <Camera size={30} />
        <p className="eyebrow">OFFLINE-FIRST EVIDENCE</p>
        <h2>Capture an observation</h2>
        <p>
          Assign field context before opening the camera. Coordinates, accuracy,
          time, metadata, and media remain queued safely when offline.
        </p>
      </header>

      <div className="capture-context">
        <label>
          <span><MapPin size={14} /> Assign to</span>
          <select
            aria-label="Assign observation to"
            value={target}
            onChange={(event) => setTarget(event.currentTarget.value)}
          >
            <option value="">Unassigned location</option>
            {fields.length > 0 && (
              <optgroup label="Crop fields">
                {fields.map((field) => (
                  <option key={field.id} value={`field:${field.id}`}>
                    {field.cropIcon} {field.name} · {field.crop}
                  </option>
                ))}
              </optgroup>
            )}
            {ecologicalSites.length > 0 && (
              <optgroup label="Ecological sites">
                {ecologicalSites.map((site) => (
                  <option key={site.id} value={`site:${site.id}`}>
                    🌿 {site.name} · {site.siteType}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label>
          Category
          <select
            aria-label="Observation category"
            value={category}
            onChange={(event) =>
              setCategory(event.currentTarget.value as Observation['category'])
            }
          >
            {categories.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label>
          Observation title
          <input
            value={title}
            maxLength={120}
            placeholder="What are you documenting?"
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>

        <label>
          Notes
          <textarea
            value={notes}
            rows={3}
            maxLength={2_000}
            placeholder="Condition, treatment, species, damage, or follow-up"
            onChange={(event) => setNotes(event.currentTarget.value)}
          />
        </label>
      </div>

      {depth.supported && (
        <label className="depth-mode">
          Depth output
          <select
            aria-label="Depth output"
            value={depthMode}
            onChange={(event) =>
              setDepthMode(event.currentTarget.value as DepthScanMode)
            }
          >
            <option value="measure">Measurements</option>
            {depth.supportsPointCloud && (
              <option value="point_cloud">Measurements + point cloud</option>
            )}
            {depth.supportsMesh && (
              <option value="mesh">Measurements + 3D model</option>
            )}
          </select>
        </label>
      )}

      <div className="capture-actions">
        <button
          className="primary-action"
          type="button"
          disabled={busy !== null}
          onClick={() => void capture('photo')}
        >
          <Camera size={19} />
          {busy === 'photo' ? 'Capturing photo…' : 'Take geotagged photo'}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy !== null}
          onClick={() => void capture('video')}
        >
          <Video size={19} />
          {busy === 'video' ? 'Recording video…' : 'Record geotagged video'}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy !== null || !depth.supported}
          onClick={() => void capture('depth')}
        >
          <ScanLine size={19} />
          {busy === 'depth'
            ? 'Capturing depth…'
            : depth.supported
              ? `Start ${depth.provider} scan`
              : 'Depth unavailable on this device'}
        </button>
      </div>

      <div className="capture-integrity">
        <Database size={14} />
        <span>Saved locally first · synchronized with revision protection</span>
      </div>
      {depth.reason && <small className="capability-note">{depth.reason}</small>}
      {error && <p className="capture-error" role="alert">{error}</p>}
    </section>
  )
}
