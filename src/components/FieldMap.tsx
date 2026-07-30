import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Field, SensorReading, TakContact } from '../domain/models'
import type { Coordinate } from '../domain/models'
import { normalizeBoundary } from '../domain/boundary'
import type { TakActivity } from '../tak/activity'
import {
  activeRasterSource,
  rasterStyleUrl,
  registerRasterTileProtocol,
} from '../maps/tileSource'

interface FieldMapProps {
  fields: Field[]
  readings: SensorReading[]
  contacts: TakContact[]
  activity: TakActivity[]
  draft: { kind: 'marker' | 'route' | 'shape'; points: Coordinate[] } | null
  onMapPress: ((coordinate: Coordinate) => void) | null
}

function fieldCollection(fields: Field[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fields.flatMap((field) => {
      try {
        return [{
          type: 'Feature' as const,
          properties: {
            id: field.id,
            name: field.name,
            crop: field.crop,
            icon: field.cropIcon,
            status: field.status,
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [normalizeBoundary(field.boundary)],
          },
        }]
      } catch {
        return []
      }
    }),
  }
}

function readingCollection(
  readings: SensorReading[],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: readings.map((reading) => ({
      type: 'Feature',
      properties: {
        id: reading.id,
        label: reading.label,
        value: reading.value,
        unit: reading.unit,
      },
      geometry: {
        type: 'Point',
        coordinates: [
          reading.coordinate.longitude,
          reading.coordinate.latitude,
        ],
      },
    })),
  }
}

function activityPointCollection(activity: TakActivity[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: activity
      .filter((item) => item.kind === 'marker' || item.kind === 'emergency')
      .map((item) => ({
        type: 'Feature',
        properties: {
          id: item.id,
          title: item.title,
          kind: item.kind,
          direction: item.direction,
        },
        geometry: {
          type: 'Point',
          coordinates: [
            item.coordinate.longitude,
            item.coordinate.latitude,
          ],
        },
      })),
  }
}

function activityLineCollection(activity: TakActivity[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: activity
      .filter(
        (item) =>
          (item.kind === 'route' || item.kind === 'shape') &&
          item.points.length >= 2,
      )
      .map((item) => {
        const properties = {
          id: item.id,
          title: item.title,
          kind: item.kind,
          direction: item.direction,
        }
        const coordinates = item.points.map((point) => [
          point.longitude,
          point.latitude,
        ])
        if (item.kind === 'shape' && item.points.length >= 3) {
          return {
            type: 'Feature' as const,
            properties,
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[...coordinates, coordinates[0]]],
            },
          }
        }
        return {
          type: 'Feature' as const,
          properties,
          geometry: {
            type: 'LineString' as const,
            coordinates,
          },
        }
      }),
  }
}

function draftCollection(
  draft: FieldMapProps['draft'],
): FeatureCollection {
  if (!draft || draft.points.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }
  const coordinates = draft.points.map((point) => [
    point.longitude,
    point.latitude,
  ])
  return {
    type: 'FeatureCollection',
    features: [
      ...draft.points.map((point, index) => ({
        type: 'Feature' as const,
        properties: { index: index + 1, geometry: 'point' },
        geometry: {
          type: 'Point' as const,
          coordinates: [point.longitude, point.latitude],
        },
      })),
      ...(coordinates.length >= 2
        ? [{
            type: 'Feature' as const,
            properties: { geometry: 'line' },
            geometry: {
              type: 'LineString' as const,
              coordinates,
            },
          }]
        : []),
    ],
  }
}

export function FieldMap({
  fields,
  readings,
  contacts,
  activity,
  draft,
  onMapPress,
}: FieldMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const contactMarkers = useRef<maplibregl.Marker[]>([])
  const onMapPressRef = useRef(onMapPress)
  const activityRef = useRef(activity)
  const draftRef = useRef(draft)
  onMapPressRef.current = onMapPress
  activityRef.current = activity
  draftRef.current = draft

  useEffect(() => {
    if (!container.current || map.current) return
    registerRasterTileProtocol(activeRasterSource)

    const nextMap = new maplibregl.Map({
      container: container.current,
      center: [-104.993, 39.7406],
      zoom: 14.6,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [rasterStyleUrl(activeRasterSource)],
            tileSize: 256,
            attribution: activeRasterSource.attribution,
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
    })

    nextMap.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      'top-right',
    )
    nextMap.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )

    nextMap.on('load', () => {
      nextMap.addSource('fields', {
        type: 'geojson',
        data: fieldCollection(fields),
      })
      nextMap.addLayer({
        id: 'field-fill',
        type: 'fill',
        source: 'fields',
        paint: {
          'fill-color': [
            'match',
            ['get', 'status'],
            'attention',
            '#e6a23c',
            '#54a76b',
          ],
          'fill-opacity': 0.44,
        },
      })
      nextMap.addLayer({
        id: 'field-outline',
        type: 'line',
        source: 'fields',
        paint: { 'line-color': '#f4f2e8', 'line-width': 2 },
      })
      nextMap.addLayer({
        id: 'field-label',
        type: 'symbol',
        source: 'fields',
        layout: {
          'text-field': ['concat', ['get', 'icon'], ' ', ['get', 'name']],
          'text-size': 13,
        },
        paint: {
          'text-color': '#f8f6ed',
          'text-halo-color': '#203128',
          'text-halo-width': 1.4,
        },
      })
      nextMap.addSource('readings', {
        type: 'geojson',
        data: readingCollection(readings),
      })
      nextMap.addLayer({
        id: 'sensor-dots',
        type: 'circle',
        source: 'readings',
        paint: {
          'circle-radius': 7,
          'circle-color': '#71d4d1',
          'circle-stroke-color': '#13201a',
          'circle-stroke-width': 2,
        },
      })
      nextMap.addSource('tak-activity-points', {
        type: 'geojson',
        data: activityPointCollection(activityRef.current),
      })
      nextMap.addLayer({
        id: 'tak-activity-points',
        type: 'circle',
        source: 'tak-activity-points',
        paint: {
          'circle-radius': 8,
          'circle-color': [
            'match',
            ['get', 'kind'],
            'emergency',
            '#ef6b63',
            '#f3e8ae',
          ],
          'circle-stroke-color': '#13201a',
          'circle-stroke-width': 2,
        },
      })
      nextMap.addSource('tak-activity-lines', {
        type: 'geojson',
        data: activityLineCollection(activityRef.current),
      })
      nextMap.addLayer({
        id: 'tak-activity-shape-fill',
        type: 'fill',
        source: 'tak-activity-lines',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#efb75e',
          'fill-opacity': 0.18,
        },
      })
      nextMap.addLayer({
        id: 'tak-activity-lines',
        type: 'line',
        source: 'tak-activity-lines',
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'shape',
            '#efb75e',
            '#71d4d1',
          ],
          'line-width': 4,
          'line-opacity': 0.9,
        },
      })
      nextMap.addSource('tak-draft', {
        type: 'geojson',
        data: draftCollection(draftRef.current),
      })
      nextMap.addLayer({
        id: 'tak-draft-line',
        type: 'line',
        source: 'tak-draft',
        filter: ['==', ['get', 'geometry'], 'line'],
        paint: {
          'line-color': '#f8f6ed',
          'line-width': 3,
          'line-dasharray': [1.5, 1.5],
        },
      })
      nextMap.addLayer({
        id: 'tak-draft-points',
        type: 'circle',
        source: 'tak-draft',
        filter: ['==', ['get', 'geometry'], 'point'],
        paint: {
          'circle-radius': 7,
          'circle-color': '#89cf78',
          'circle-stroke-color': '#f8f6ed',
          'circle-stroke-width': 2,
        },
      })
    })
    nextMap.on('click', (event) => {
      onMapPressRef.current?.({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
        altitudeMeters: null,
        horizontalAccuracyMeters: null,
        verticalAccuracyMeters: null,
        headingDegrees: null,
      })
    })

    map.current = nextMap
    return () => {
      contactMarkers.current.forEach((marker) => marker.remove())
      nextMap.remove()
      map.current = null
    }
  }, [fields, readings])

  useEffect(() => {
    const currentMap = map.current
    if (!currentMap?.isStyleLoaded()) return
    ;(currentMap.getSource('fields') as GeoJSONSource | undefined)?.setData(
      fieldCollection(fields),
    )
    ;(currentMap.getSource('readings') as GeoJSONSource | undefined)?.setData(
      readingCollection(readings),
    )
  }, [fields, readings])

  useEffect(() => {
    const currentMap = map.current
    if (!currentMap?.isStyleLoaded()) return
    ;(
      currentMap.getSource('tak-activity-points') as
        | GeoJSONSource
        | undefined
    )?.setData(activityPointCollection(activity))
    ;(
      currentMap.getSource('tak-activity-lines') as
        | GeoJSONSource
        | undefined
    )?.setData(activityLineCollection(activity))
  }, [activity])

  useEffect(() => {
    const currentMap = map.current
    if (!currentMap?.isStyleLoaded()) return
    ;(currentMap.getSource('tak-draft') as GeoJSONSource | undefined)?.setData(
      draftCollection(draft),
    )
    currentMap.getCanvas().style.cursor = draft ? 'crosshair' : ''
  }, [draft])

  useEffect(() => {
    if (!map.current) return
    contactMarkers.current.forEach((marker) => marker.remove())
    contactMarkers.current = contacts.map((contact) => {
      const marker = document.createElement('div')
      marker.className = 'tak-contact-marker'
      marker.textContent = contact.callsign.slice(0, 2).toUpperCase()
      marker.title = contact.callsign
      return new maplibregl.Marker({ element: marker })
        .setLngLat([
          contact.coordinate.longitude,
          contact.coordinate.latitude,
        ])
        .addTo(map.current!)
    })
  }, [contacts])

  return (
    <div className="map-frame">
      <div
        ref={container}
        className="field-map"
        aria-label="Map of fields, sensors, and TAK contacts"
      />
      <div className="map-legend" aria-label="Map legend">
        <span><i className="legend-field" /> Field</span>
        <span><i className="legend-sensor" /> LoRaWAN</span>
        <span><i className="legend-team" /> Team</span>
        <span><i className="legend-tak" /> TAK</span>
      </div>
    </div>
  )
}
