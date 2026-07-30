import { useMemo, useState } from 'react'
import {
  Crosshair,
  MapPinned,
  RotateCcw,
  SquareDashed,
  Trash2,
} from 'lucide-react'
import type { Coordinate } from '../domain/models'
import {
  boundaryAreaHectares,
  type BoundaryPoint,
  normalizeBoundary,
  squareBoundaryMeters,
} from '../domain/boundary'
import { currentCoordinate } from '../platform/capture'

interface BoundaryEditorProps {
  vertices: BoundaryPoint[]
  onChange: (vertices: BoundaryPoint[]) => void
  center?: Pick<Coordinate, 'latitude' | 'longitude'> | null
  locate?: () => Promise<Coordinate>
}

function finiteCoordinate(value: string, minimum: number, maximum: number) {
  const parsed = Number(value)
  return value.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
    ? parsed
    : null
}

function previewPoints(vertices: BoundaryPoint[]) {
  if (vertices.length === 0) return ''
  const referenceLatitude =
    vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length
  const longitudeScale = Math.cos(referenceLatitude * Math.PI / 180)
  const projected = vertices.map(([longitude, latitude]) => [
    longitude * longitudeScale,
    latitude,
  ] as BoundaryPoint)
  const horizontal = projected.map((point) => point[0])
  const vertical = projected.map((point) => point[1])
  const minimumX = Math.min(...horizontal)
  const maximumX = Math.max(...horizontal)
  const minimumY = Math.min(...vertical)
  const maximumY = Math.max(...vertical)
  const width = maximumX - minimumX
  const height = maximumY - minimumY
  const scale = Math.min(176 / (width || 1), 96 / (height || 1))
  const centerX = (minimumX + maximumX) / 2
  const centerY = (minimumY + maximumY) / 2
  return projected
    .map(([xCoordinate, yCoordinate]) => {
      const x = 100 + (xCoordinate - centerX) * scale
      const y = 60 - (yCoordinate - centerY) * scale
      return `${x},${y}`
    })
    .join(' ')
}

export function BoundaryEditor({
  vertices,
  onChange,
  center,
  locate = currentCoordinate,
}: BoundaryEditorProps) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [locating, setLocating] = useState(false)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preview = previewPoints(vertices)
  const normalized = useMemo(() => {
    try {
      return { boundary: normalizeBoundary(vertices), error: null }
    } catch (cause) {
      return {
        boundary: null,
        error: cause instanceof Error ? cause.message : 'Boundary is invalid.',
      }
    }
  }, [vertices])
  const area = normalized.boundary
    ? boundaryAreaHectares(normalized.boundary)
    : 0

  async function addGpsVertex() {
    setLocating(true)
    setError(null)
    try {
      const coordinate = await locate()
      onChange([...vertices, [coordinate.longitude, coordinate.latitude]])
      setAccuracy(coordinate.horizontalAccuracyMeters)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Current location is unavailable.',
      )
    } finally {
      setLocating(false)
    }
  }

  function addManualVertex() {
    setError(null)
    const nextLatitude = finiteCoordinate(latitude, -90, 90)
    const nextLongitude = finiteCoordinate(longitude, -180, 180)
    if (nextLatitude === null || nextLongitude === null) {
      setError('Enter a valid latitude and longitude.')
      return
    }
    onChange([...vertices, [nextLongitude, nextLatitude]])
    setLatitude('')
    setLongitude('')
  }

  async function createStarterBoundary() {
    setLocating(true)
    setError(null)
    try {
      let anchor = center
      if (!anchor) {
        const coordinate = await locate()
        anchor = coordinate
        setAccuracy(coordinate.horizontalAccuracyMeters)
      }
      onChange(squareBoundaryMeters(anchor).slice(0, -1))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Starter boundary is unavailable.',
      )
    } finally {
      setLocating(false)
    }
  }

  return (
    <section className="boundary-editor" aria-label="Boundary">
      <header>
        <div>
          <MapPinned size={17} />
          <div>
            <strong>Boundary</strong>
            <p>Walk the perimeter and add a vertex at each turn, or enter coordinates.</p>
          </div>
        </div>
        <span className={normalized.boundary ? 'valid' : ''}>
          {vertices.length} vertices
        </span>
      </header>

      <div className="boundary-preview">
        {vertices.length === 0 ? (
          <div>
            <SquareDashed size={25} />
            <span>No boundary recorded</span>
          </div>
        ) : (
          <svg
            role="img"
            aria-label={`Boundary preview with ${vertices.length} vertices`}
            viewBox="0 0 200 120"
            preserveAspectRatio="xMidYMid meet"
          >
            {vertices.length >= 3 ? (
              <polygon points={preview} />
            ) : (
              <polyline points={preview} />
            )}
            {preview.split(' ').map((point, index) => {
              const [cx, cy] = point.split(',')
              return <circle key={`${point}-${index}`} cx={cx} cy={cy} r="3" />
            })}
          </svg>
        )}
        <div className="boundary-metrics">
          <strong>{normalized.boundary ? area.toFixed(area < 0.1 ? 3 : 2) : '—'} ha</strong>
          <span>
            {normalized.boundary
              ? 'Closed polygon ready to save'
              : normalized.error}
          </span>
        </div>
      </div>

      <button
        className="boundary-gps"
        type="button"
        disabled={locating}
        onClick={() => void addGpsVertex()}
      >
        <Crosshair size={16} />
        {locating ? 'Getting GPS fix…' : 'Add current GPS vertex'}
      </button>
      {accuracy !== null && (
        <p className="boundary-accuracy">
          Last GPS fix ±{Math.round(accuracy)} m
        </p>
      )}

      <div className="boundary-manual">
        <label>
          <span>Vertex latitude</span>
          <input
            aria-label="Vertex latitude"
            inputMode="decimal"
            value={latitude}
            onChange={(event) => setLatitude(event.currentTarget.value)}
            placeholder="39.740600"
          />
        </label>
        <label>
          <span>Vertex longitude</span>
          <input
            aria-label="Vertex longitude"
            inputMode="decimal"
            value={longitude}
            onChange={(event) => setLongitude(event.currentTarget.value)}
            placeholder="-104.993000"
          />
        </label>
        <button type="button" onClick={addManualVertex}>Add</button>
      </div>

      <div className="boundary-actions">
        <button
          type="button"
          disabled={vertices.length === 0}
          onClick={() => onChange(vertices.slice(0, -1))}
        >
          <RotateCcw size={14} /> Undo
        </button>
        <button
          type="button"
          disabled={vertices.length === 0}
          onClick={() => onChange([])}
        >
          <Trash2 size={14} /> Clear
        </button>
        <button
          type="button"
          disabled={locating}
          onClick={() => void createStarterBoundary()}
        >
          <SquareDashed size={14} /> 100 m starter square
        </button>
      </div>
      <p className="boundary-advisory">
        A starter square is an editable estimate, not a surveyed boundary.
      </p>
      {error && <p className="boundary-error" role="alert">{error}</p>}
    </section>
  )
}
