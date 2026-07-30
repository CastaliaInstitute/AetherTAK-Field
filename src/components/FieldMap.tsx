import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Field, SensorReading, TakContact } from '../domain/models'
import {
  activeRasterSource,
  rasterStyleUrl,
  registerRasterTileProtocol,
} from '../maps/tileSource'

interface FieldMapProps {
  fields: Field[]
  readings: SensorReading[]
  contacts: TakContact[]
}

function fieldCollection(fields: Field[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fields.map((field) => ({
      type: 'Feature',
      properties: {
        id: field.id,
        name: field.name,
        crop: field.crop,
        icon: field.cropIcon,
        status: field.status,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [field.boundary],
      },
    })),
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

export function FieldMap({ fields, readings, contacts }: FieldMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const contactMarkers = useRef<maplibregl.Marker[]>([])

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
      </div>
    </div>
  )
}
