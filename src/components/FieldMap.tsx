import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import type {
  Alert,
  AlInsight,
  Coordinate,
  EcologicalSite,
  Field,
  Observation,
  SensorReading,
  TakContact,
} from '../domain/models'
import type { TakActivity } from '../tak/activity'
import {
  activeRasterSource,
  rasterStyleUrl,
  registerRasterTileProtocol,
} from '../maps/tileSource'
import {
  alertCollection,
  ecologicalSiteCollection,
  fieldCollection,
  insightCollection,
  observationCollection,
  readingCollection,
} from '../maps/fieldLayers'

interface FieldMapProps {
  fields: Field[]
  ecologicalSites: EcologicalSite[]
  readings: SensorReading[]
  observations: Observation[]
  alerts: Alert[]
  insights: AlInsight[]
  contacts: TakContact[]
  activity: TakActivity[]
  draft: {
    kind: 'marker' | 'route' | 'shape'
    closed: boolean | null
    points: Coordinate[]
  } | null
  onMapPress: ((coordinate: Coordinate) => void) | null
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
        if (
          item.kind === 'shape' &&
          item.closed !== false &&
          item.points.length >= 3
        ) {
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
              coordinates:
                draft.kind === 'shape' &&
                draft.closed === true &&
                coordinates.length >= 3
                  ? [...coordinates, coordinates[0]]
                  : coordinates,
            },
          }]
        : []),
    ],
  }
}

const detailLayerIds = [
  'monitoring-alerts',
  'al-insights',
  'observations',
  'observation-dots',
  'sensor-dots',
  'ecological-site-label',
  'ecological-site-fill',
  'field-label',
  'field-fill',
]

function mapDetailContent(properties: Record<string, unknown>) {
  const content = document.createElement('article')
  content.className = 'field-map-detail'
  const eyebrow = document.createElement('p')
  eyebrow.textContent = String(properties.eyebrow ?? 'Map item')
  const title = document.createElement('strong')
  title.textContent = String(properties.title ?? 'Untitled')
  const detail = document.createElement('span')
  detail.textContent = String(properties.detail ?? '')
  content.append(eyebrow, title)
  if (detail.textContent) content.append(detail)
  return content
}

export function FieldMap({
  fields,
  ecologicalSites,
  readings,
  observations,
  alerts,
  insights,
  contacts,
  activity,
  draft,
  onMapPress,
}: FieldMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const contactMarkers = useRef<maplibregl.Marker[]>([])
  const detailPopup = useRef<maplibregl.Popup | null>(null)
  const onMapPressRef = useRef(onMapPress)
  const fieldsRef = useRef(fields)
  const ecologicalSitesRef = useRef(ecologicalSites)
  const readingsRef = useRef(readings)
  const observationsRef = useRef(observations)
  const alertsRef = useRef(alerts)
  const insightsRef = useRef(insights)
  const activityRef = useRef(activity)
  const draftRef = useRef(draft)
  onMapPressRef.current = onMapPress
  fieldsRef.current = fields
  ecologicalSitesRef.current = ecologicalSites
  readingsRef.current = readings
  observationsRef.current = observations
  alertsRef.current = alerts
  insightsRef.current = insights
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
        data: fieldCollection(fieldsRef.current),
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
          'text-field': ['concat', ['get', 'icon'], ' ', ['get', 'title']],
          'text-size': 13,
        },
        paint: {
          'text-color': '#f8f6ed',
          'text-halo-color': '#203128',
          'text-halo-width': 1.4,
        },
      })
      nextMap.addSource('ecological-sites', {
        type: 'geojson',
        data: ecologicalSiteCollection(ecologicalSitesRef.current),
      })
      nextMap.addLayer({
        id: 'ecological-site-fill',
        type: 'fill',
        source: 'ecological-sites',
        paint: {
          'fill-color': '#3f9e86',
          'fill-opacity': 0.18,
        },
      })
      nextMap.addLayer({
        id: 'ecological-site-outline',
        type: 'line',
        source: 'ecological-sites',
        paint: {
          'line-color': '#79d8bd',
          'line-width': 2,
          'line-dasharray': [2, 1.5],
        },
      })
      nextMap.addLayer({
        id: 'ecological-site-label',
        type: 'symbol',
        source: 'ecological-sites',
        layout: {
          'text-field': ['concat', ['get', 'icon'], ' ', ['get', 'title']],
          'text-size': 12,
          'text-offset': [0, 1.2],
        },
        paint: {
          'text-color': '#baf1df',
          'text-halo-color': '#173129',
          'text-halo-width': 1.4,
        },
      })
      nextMap.addSource('readings', {
        type: 'geojson',
        data: readingCollection(readingsRef.current),
      })
      nextMap.addLayer({
        id: 'sensor-dots',
        type: 'circle',
        source: 'readings',
        paint: {
          'circle-radius': 7,
          'circle-color': [
            'match',
            ['get', 'quality'],
            'suspect',
            '#ef6b63',
            'estimated',
            '#efb75e',
            '#71d4d1',
          ],
          'circle-stroke-color': '#13201a',
          'circle-stroke-width': 2,
        },
      })
      nextMap.addLayer({
        id: 'sensor-values',
        type: 'symbol',
        source: 'readings',
        layout: {
          'text-field': ['get', 'valueLabel'],
          'text-size': 11,
          'text-offset': [0, 1.45],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#d9ffff',
          'text-halo-color': '#13201a',
          'text-halo-width': 1.5,
        },
      })
      nextMap.addSource('observations', {
        type: 'geojson',
        data: observationCollection(observationsRef.current),
      })
      nextMap.addLayer({
        id: 'observation-dots',
        type: 'circle',
        source: 'observations',
        paint: {
          'circle-radius': 10,
          'circle-color': '#17231d',
          'circle-stroke-color': '#f3e8ae',
          'circle-stroke-width': 1.5,
        },
      })
      nextMap.addLayer({
        id: 'observations',
        type: 'symbol',
        source: 'observations',
        layout: {
          'text-field': ['get', 'icon'],
          'text-size': 14,
          'text-allow-overlap': true,
        },
      })
      nextMap.addSource('monitoring-alerts', {
        type: 'geojson',
        data: alertCollection(
          alertsRef.current,
          fieldsRef.current,
          readingsRef.current,
        ),
      })
      nextMap.addLayer({
        id: 'monitoring-alerts',
        type: 'circle',
        source: 'monitoring-alerts',
        paint: {
          'circle-radius': 11,
          'circle-color': [
            'match',
            ['get', 'severity'],
            'critical',
            '#ef6b63',
            'warning',
            '#efb75e',
            '#71d4d1',
          ],
          'circle-opacity': [
            'case',
            ['==', ['get', 'acknowledged'], 1],
            0.45,
            0.95,
          ],
          'circle-stroke-color': '#17231d',
          'circle-stroke-width': 2,
        },
      })
      nextMap.addLayer({
        id: 'monitoring-alert-labels',
        type: 'symbol',
        source: 'monitoring-alerts',
        layout: {
          'text-field': '!',
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#17231d',
        },
      })
      nextMap.addSource('al-insights', {
        type: 'geojson',
        data: insightCollection(
          insightsRef.current,
          fieldsRef.current,
          ecologicalSitesRef.current,
        ),
      })
      nextMap.addLayer({
        id: 'al-insights',
        type: 'circle',
        source: 'al-insights',
        paint: {
          'circle-radius': 12,
          'circle-color': '#d9c887',
          'circle-stroke-color': '#17231d',
          'circle-stroke-width': 2,
        },
      })
      nextMap.addLayer({
        id: 'al-insight-labels',
        type: 'symbol',
        source: 'al-insights',
        layout: {
          'text-field': 'Al',
          'text-size': 10,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#17231d',
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
      if (onMapPressRef.current) {
        detailPopup.current?.remove()
        onMapPressRef.current({
          latitude: event.lngLat.lat,
          longitude: event.lngLat.lng,
          altitudeMeters: null,
          horizontalAccuracyMeters: null,
          verticalAccuracyMeters: null,
          headingDegrees: null,
        })
        return
      }
      const availableLayers = detailLayerIds.filter((id) =>
        Boolean(nextMap.getLayer(id)))
      if (availableLayers.length === 0) return
      const feature = nextMap.queryRenderedFeatures(event.point, {
        layers: availableLayers,
      })[0]
      if (!feature?.properties) return
      detailPopup.current?.remove()
      detailPopup.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 14,
        maxWidth: '260px',
      })
        .setLngLat(event.lngLat)
        .setDOMContent(mapDetailContent(feature.properties))
        .addTo(nextMap)
    })
    nextMap.on('mousemove', (event) => {
      if (onMapPressRef.current) {
        nextMap.getCanvas().style.cursor = 'crosshair'
        return
      }
      const availableLayers = detailLayerIds.filter((id) =>
        Boolean(nextMap.getLayer(id)))
      if (availableLayers.length === 0) {
        nextMap.getCanvas().style.cursor = ''
        return
      }
      nextMap.getCanvas().style.cursor = nextMap.queryRenderedFeatures(
        event.point,
        { layers: availableLayers },
      ).length > 0
        ? 'pointer'
        : ''
    })

    map.current = nextMap
    return () => {
      detailPopup.current?.remove()
      contactMarkers.current.forEach((marker) => marker.remove())
      nextMap.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const currentMap = map.current
    if (!currentMap?.isStyleLoaded()) return
    ;(currentMap.getSource('fields') as GeoJSONSource | undefined)?.setData(
      fieldCollection(fields),
    )
    ;(currentMap.getSource('readings') as GeoJSONSource | undefined)?.setData(
      readingCollection(readings),
    )
    ;(
      currentMap.getSource('ecological-sites') as GeoJSONSource | undefined
    )?.setData(ecologicalSiteCollection(ecologicalSites))
    ;(
      currentMap.getSource('observations') as GeoJSONSource | undefined
    )?.setData(observationCollection(observations))
    ;(
      currentMap.getSource('monitoring-alerts') as GeoJSONSource | undefined
    )?.setData(alertCollection(alerts, fields, readings))
    ;(
      currentMap.getSource('al-insights') as GeoJSONSource | undefined
    )?.setData(insightCollection(insights, fields, ecologicalSites))
  }, [
    alerts,
    ecologicalSites,
    fields,
    insights,
    observations,
    readings,
  ])

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
        aria-label="Map of crop fields, ecological sites, sensor data, field evidence, alerts, Al insights, and TAK contacts"
      />
      <div className="map-legend" aria-label="Map legend">
        <span><i className="legend-field" /> Field</span>
        <span><i className="legend-ecology" /> Ecology</span>
        <span><i className="legend-sensor" /> Sensor</span>
        <span><i className="legend-evidence" /> Evidence</span>
        <span><i className="legend-alert" /> Alert</span>
        <span><i className="legend-al" /> Al</span>
        <span><i className="legend-team" /> Team</span>
        <span><i className="legend-tak" /> TAK</span>
      </div>
    </div>
  )
}
