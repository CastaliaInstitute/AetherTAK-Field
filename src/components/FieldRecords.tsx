import { useState, type FormEvent } from 'react'
import {
  Bell,
  Check,
  ChevronRight,
  Leaf,
  MapPin,
  Pencil,
  Plus,
  Sprout,
  X,
} from 'lucide-react'
import type { Coordinate } from '../domain/models'
import {
  ecologicalSiteSchema,
  fieldSchema,
  propertySchema,
  seasonSchema,
} from '../domain/models'
import type { FieldDashboard } from '../data/useDashboard'
import { saveLocalEntity } from '../data/fieldRepository'
import { currentCoordinate } from '../platform/capture'
import { ObservationDetail } from './ObservationDetail'
import { ConflictCenter } from './ConflictCenter'
import { resolveFieldConflict } from '../sync/fieldSync'

type EditableKind = 'property' | 'season' | 'field' | 'ecological_site'
type Editor = { kind: EditableKind; id?: string } | null

interface FieldRecordsProps {
  data: FieldDashboard
  onNotice: (message: string) => void
}

function squareBoundary(coordinate: Coordinate, radius = 0.00045) {
  const { longitude, latitude } = coordinate
  return [
    [longitude - radius, latitude - radius],
    [longitude + radius, latitude - radius],
    [longitude + radius, latitude + radius],
    [longitude - radius, latitude + radius],
    [longitude - radius, latitude - radius],
  ] as Array<[number, number]>
}

function finiteNumber(value: FormDataEntryValue | null, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`)
  return parsed
}

function optionalNumber(value: FormDataEntryValue | null) {
  if (value === null || String(value).trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('Expected a valid number.')
  return parsed
}

function editorTitle(kind: EditableKind, editing: boolean) {
  const label = kind === 'ecological_site' ? 'ecological site' : kind
  return `${editing ? 'Edit' : 'New'} ${label}`
}

export function FieldRecords({ data, onNotice }: FieldRecordsProps) {
  const [editor, setEditor] = useState<Editor>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<Coordinate | null>(null)
  const [selectedObservationId, setSelectedObservationId] =
    useState<string | null>(null)

  const property = editor?.kind === 'property' && editor.id
    ? data.properties.find((item) => item.id === editor.id)
    : undefined
  const season = editor?.kind === 'season' && editor.id
    ? data.seasons.find((item) => item.id === editor.id)
    : undefined
  const field = editor?.kind === 'field' && editor.id
    ? data.fields.find((item) => item.id === editor.id)
    : undefined
  const site = editor?.kind === 'ecological_site' && editor.id
    ? data.ecologicalSites.find((item) => item.id === editor.id)
    : undefined
  const selectedObservation = selectedObservationId
    ? data.observations.find((item) => item.id === selectedObservationId)
    : undefined

  function open(kind: EditableKind, id?: string) {
    const selectedProperty =
      kind === 'property' && id
        ? data.properties.find((item) => item.id === id)
        : undefined
    setEditor({ kind, id })
    setError(null)
    setLocation(
      kind === 'property'
        ? selectedProperty?.center ?? data.properties[0]?.center ?? null
        : null,
    )
  }

  async function locate() {
    setError(null)
    try {
      setLocation(await currentCoordinate())
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Current location is unavailable.',
      )
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    setSaving(true)
    setError(null)
    try {
      const form = new FormData(event.currentTarget)
      const now = new Date().toISOString()
      switch (editor.kind) {
        case 'property': {
          const coordinate = {
            latitude: finiteNumber(form.get('latitude'), 'Latitude'),
            longitude: finiteNumber(form.get('longitude'), 'Longitude'),
            altitudeMeters: location?.altitudeMeters ?? property?.center.altitudeMeters ?? null,
            horizontalAccuracyMeters:
              location?.horizontalAccuracyMeters ??
              property?.center.horizontalAccuracyMeters ??
              null,
            verticalAccuracyMeters:
              location?.verticalAccuracyMeters ??
              property?.center.verticalAccuracyMeters ??
              null,
            headingDegrees: null,
          }
          const value = propertySchema.parse({
            id: property?.id ?? crypto.randomUUID(),
            name: form.get('name'),
            description: form.get('description') ?? '',
            center: coordinate,
            boundary: property?.boundary ?? squareBoundary(coordinate),
            timezone: form.get('timezone'),
            updatedAt: now,
            syncState: 'queued',
          })
          await saveLocalEntity({ type: 'property', value })
          break
        }
        case 'season': {
          const value = seasonSchema.parse({
            id: season?.id ?? crypto.randomUUID(),
            propertyId: form.get('propertyId'),
            name: form.get('name'),
            startsOn: form.get('startsOn'),
            endsOn: form.get('endsOn'),
            status: form.get('status'),
            notes: form.get('notes') ?? '',
            updatedAt: now,
            syncState: 'queued',
          })
          await saveLocalEntity({ type: 'season', value })
          break
        }
        case 'field': {
          const propertyId = String(form.get('propertyId'))
          const seasonId = String(form.get('seasonId'))
          const parent = data.properties.find((item) => item.id === propertyId)
          const growingSeason = data.seasons.find((item) => item.id === seasonId)
          if (
            !parent ||
            !growingSeason ||
            growingSeason.propertyId !== propertyId
          ) {
            throw new Error('Select a property and season.')
          }
          const value = fieldSchema.parse({
            id: field?.id ?? crypto.randomUUID(),
            propertyId,
            seasonId,
            name: form.get('name'),
            crop: form.get('crop'),
            cropIcon: form.get('cropIcon'),
            variety: String(form.get('variety') ?? '').trim() || null,
            seasonLabel: growingSeason.name,
            status: form.get('status'),
            healthScore: optionalNumber(form.get('healthScore')),
            boundary: field?.boundary ?? squareBoundary(parent.center, 0.00018),
            updatedAt: now,
            syncState: 'queued',
          })
          await saveLocalEntity({ type: 'field', value })
          break
        }
        case 'ecological_site': {
          const propertyId = String(form.get('propertyId'))
          const parent = data.properties.find((item) => item.id === propertyId)
          if (!parent) throw new Error('Select a property.')
          const value = ecologicalSiteSchema.parse({
            id: site?.id ?? crypto.randomUUID(),
            propertyId,
            name: form.get('name'),
            siteType: form.get('siteType'),
            targetCondition: form.get('targetCondition') ?? '',
            conditionScore: optionalNumber(form.get('conditionScore')),
            center: site?.center ?? parent.center,
            boundary: site?.boundary ?? squareBoundary(parent.center, 0.00018),
            indicatorSpecies: String(form.get('indicatorSpecies') ?? '')
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
            updatedAt: now,
            syncState: 'queued',
          })
          await saveLocalEntity({ type: 'ecological_site', value })
          break
        }
      }
      onNotice(`${editorTitle(editor.kind, Boolean(editor.id))} saved offline.`)
      setEditor(null)
      setLocation(null)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The field record could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function acknowledgeAlert(id: string) {
    const alert = data.alerts.find((item) => item.id === id)
    if (!alert || alert.acknowledgedAt) return
    await saveLocalEntity({
      type: 'alert',
      value: {
        ...alert,
        acknowledgedAt: new Date().toISOString(),
        syncState: 'queued',
      },
    })
    onNotice(`Acknowledged ${alert.title}.`)
  }

  return (
    <section className="field-records-page">
      <header className="records-heading">
        <div>
          <Sprout size={28} />
          <p className="eyebrow">PROPERTIES · SEASONS · ECOLOGY</p>
          <h2>Field records</h2>
        </div>
        <div className="records-add-menu" aria-label="Add field record">
          <button type="button" onClick={() => open('property')}>
            <Plus size={15} /> Property
          </button>
          <button
            type="button"
            disabled={data.properties.length === 0}
            onClick={() => open('season')}
          >
            <Plus size={15} /> Season
          </button>
          <button
            type="button"
            disabled={data.seasons.length === 0}
            onClick={() => open('field')}
          >
            <Plus size={15} /> Crop field
          </button>
          <button
            type="button"
            disabled={data.properties.length === 0}
            onClick={() => open('ecological_site')}
          >
            <Plus size={15} /> Ecology
          </button>
        </div>
      </header>

      <ConflictCenter
        conflicts={data.conflicts}
        onResolve={resolveFieldConflict}
        onNotice={onNotice}
      />

      {data.properties.length === 0 && (
        <div className="records-empty">
          <MapPin size={22} />
          <strong>Create the first property</strong>
          <p>Field, season, crop, ecological, and sensor records attach to a property.</p>
        </div>
      )}

      {data.properties.map((item) => (
        <article className="record-row editable" key={item.id}>
          <span>🏡</span>
          <div>
            <strong>{item.name}</strong>
            <p>
              {data.seasons.filter((value) => value.propertyId === item.id).length} seasons
              {' · '}
              {item.syncState}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Edit property ${item.name}`}
            onClick={() => open('property', item.id)}
          >
            <Pencil size={17} />
          </button>
        </article>
      ))}

      {data.seasons.map((item) => (
        <article className="record-row editable" key={item.id}>
          <span>🗓️</span>
          <div>
            <strong>{item.name}</strong>
            <p>{item.startsOn}–{item.endsOn} · {item.status} · {item.syncState}</p>
          </div>
          <button
            type="button"
            aria-label={`Edit season ${item.name}`}
            onClick={() => open('season', item.id)}
          >
            <Pencil size={17} />
          </button>
        </article>
      ))}

      {data.fields.map((item) => (
        <article className="record-row editable" key={item.id}>
          <span>{item.cropIcon}</span>
          <div>
            <strong>{item.name}</strong>
            <p>{item.seasonLabel} · {item.crop} · {item.status} · {item.syncState}</p>
          </div>
          <button
            type="button"
            aria-label={`Edit crop field ${item.name}`}
            onClick={() => open('field', item.id)}
          >
            <Pencil size={17} />
          </button>
        </article>
      ))}

      {data.ecologicalSites.map((item) => (
        <article className="record-row editable" key={item.id}>
          <span>🌿</span>
          <div>
            <strong>{item.name}</strong>
            <p>{item.siteType} · {item.conditionScore ?? '—'} condition · {item.syncState}</p>
          </div>
          <button
            type="button"
            aria-label={`Edit ecological site ${item.name}`}
            onClick={() => open('ecological_site', item.id)}
          >
            <Pencil size={17} />
          </button>
        </article>
      ))}

      <section className="records-subsection">
        <div className="records-subheading">
          <Bell size={18} />
          <div><p className="eyebrow">MONITORING</p><h3>Alerts</h3></div>
        </div>
        {data.alerts.length === 0 && <p className="records-muted">No current alerts.</p>}
        {data.alerts.map((alert) => (
          <article className={`records-alert ${alert.severity}`} key={alert.id}>
            <div>
              <strong>{alert.title}</strong>
              <p>{alert.detail} · {alert.syncState}</p>
            </div>
            <button
              type="button"
              disabled={Boolean(alert.acknowledgedAt)}
              onClick={() => void acknowledgeAlert(alert.id)}
            >
              {alert.acknowledgedAt ? <Check size={16} /> : <ChevronRight size={16} />}
              {alert.acknowledgedAt ? 'Acknowledged' : 'Acknowledge'}
            </button>
          </article>
        ))}
      </section>

      <section className="records-subsection">
        <div className="records-subheading">
          <Leaf size={18} />
          <div><p className="eyebrow">FIELD EVIDENCE</p><h3>Observations</h3></div>
        </div>
        {data.observations.length === 0 && (
          <p className="records-muted">Captured observations will appear here offline.</p>
        )}
        {data.observations.map((observation) => (
          <button
            className="observation-row"
            key={observation.id}
            type="button"
            onClick={() => setSelectedObservationId(observation.id)}
          >
            <div>
              <strong>{observation.title}</strong>
              <p>{observation.category} · {observation.mediaIds.length} media · {observation.syncState}</p>
            </div>
            <span>{new Date(observation.observedAt).toLocaleDateString()}</span>
          </button>
        ))}
      </section>

      {selectedObservation && (
        <ObservationDetail
          observation={selectedObservation}
          media={data.media}
          fields={data.fields}
          ecologicalSites={data.ecologicalSites}
          onClose={() => setSelectedObservationId(null)}
        />
      )}

      {editor && (
        <div className="record-editor-backdrop" role="presentation">
          <form
            className="record-editor"
            aria-label={editorTitle(editor.kind, Boolean(editor.id))}
            onSubmit={(event) => void save(event)}
          >
            <header>
              <div>
                <p className="eyebrow">OFFLINE SYNCED RECORD</p>
                <h3>{editorTitle(editor.kind, Boolean(editor.id))}</h3>
              </div>
              <button
                type="button"
                aria-label="Close record editor"
                onClick={() => setEditor(null)}
              >
                <X size={19} />
              </button>
            </header>

            {editor.kind === 'property' && (
              <>
                <label><span>Name</span><input name="name" required maxLength={100} defaultValue={property?.name} /></label>
                <label><span>Description</span><textarea name="description" rows={2} defaultValue={property?.description} /></label>
                <div className="record-coordinate-fields">
                  <label><span>Latitude</span><input name="latitude" required inputMode="decimal" value={location?.latitude ?? property?.center.latitude ?? ''} onChange={(event) => setLocation((value) => ({ ...(value ?? property?.center ?? data.properties[0]?.center ?? {
                    latitude: 0, longitude: 0, altitudeMeters: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null, headingDegrees: null,
                  }), latitude: Number(event.currentTarget.value) }))} /></label>
                  <label><span>Longitude</span><input name="longitude" required inputMode="decimal" value={location?.longitude ?? property?.center.longitude ?? ''} onChange={(event) => setLocation((value) => ({ ...(value ?? property?.center ?? data.properties[0]?.center ?? {
                    latitude: 0, longitude: 0, altitudeMeters: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null, headingDegrees: null,
                  }), longitude: Number(event.currentTarget.value) }))} /></label>
                </div>
                <button className="record-location-button" type="button" onClick={() => void locate()}><MapPin size={16} /> Use current location</button>
                <label><span>Timezone</span><input name="timezone" required defaultValue={property?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} /></label>
              </>
            )}

            {(editor.kind === 'season' || editor.kind === 'field' || editor.kind === 'ecological_site') && (
              <label>
                <span>Property</span>
                <select name="propertyId" required defaultValue={season?.propertyId ?? field?.propertyId ?? site?.propertyId ?? data.properties[0]?.id}>
                  {data.properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}

            {editor.kind === 'season' && (
              <>
                <label><span>Season name</span><input name="name" required maxLength={100} defaultValue={season?.name} /></label>
                <div className="record-coordinate-fields">
                  <label><span>Starts</span><input type="date" name="startsOn" required defaultValue={season?.startsOn ?? new Date().toISOString().slice(0, 10)} /></label>
                  <label><span>Ends</span><input type="date" name="endsOn" required defaultValue={season?.endsOn ?? new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10)} /></label>
                </div>
                <label><span>Status</span><select name="status" defaultValue={season?.status ?? 'active'}><option value="planned">Planned</option><option value="active">Active</option><option value="closed">Closed</option></select></label>
                <label><span>Notes</span><textarea name="notes" rows={2} defaultValue={season?.notes} /></label>
              </>
            )}

            {editor.kind === 'field' && (
              <>
                <label><span>Season</span><select name="seasonId" required defaultValue={field?.seasonId ?? data.seasons[0]?.id}>{data.seasons.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span>Field name</span><input name="name" required maxLength={100} defaultValue={field?.name} /></label>
                <div className="record-crop-fields">
                  <label><span>Crop symbol</span><input name="cropIcon" required maxLength={8} defaultValue={field?.cropIcon ?? '🥬'} /></label>
                  <label><span>Crop</span><input name="crop" required maxLength={100} defaultValue={field?.crop} /></label>
                </div>
                <label><span>Variety</span><input name="variety" maxLength={100} defaultValue={field?.variety ?? ''} /></label>
                <div className="record-coordinate-fields">
                  <label><span>Status</span><select name="status" defaultValue={field?.status ?? 'growing'}><option value="planned">Planned</option><option value="growing">Growing</option><option value="attention">Attention</option><option value="harvested">Harvested</option></select></label>
                  <label><span>Health 0–100</span><input name="healthScore" type="number" min="0" max="100" defaultValue={field?.healthScore ?? ''} /></label>
                </div>
              </>
            )}

            {editor.kind === 'ecological_site' && (
              <>
                <label><span>Site name</span><input name="name" required maxLength={100} defaultValue={site?.name} /></label>
                <label><span>Site type</span><select name="siteType" defaultValue={site?.siteType ?? 'riparian'}>{['riparian','wetland','woodland','grassland','pollinator','water','soil','other'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label><span>Target condition</span><textarea name="targetCondition" rows={2} defaultValue={site?.targetCondition} /></label>
                <label><span>Condition 0–100</span><input name="conditionScore" type="number" min="0" max="100" defaultValue={site?.conditionScore ?? ''} /></label>
                <label><span>Indicator species, comma separated</span><textarea name="indicatorSpecies" rows={2} defaultValue={site?.indicatorSpecies.join(', ')} /></label>
              </>
            )}

            {error && <p className="record-editor-error" role="alert">{error}</p>}
            <button className="primary-action record-save" type="submit" disabled={saving}>
              {saving ? 'Saving offline…' : 'Save and sync'}
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
