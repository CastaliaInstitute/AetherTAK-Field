// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSnapshot } from '../domain/seed'
import { FieldMap } from './FieldMap'

interface SourceState {
  data: unknown
  setData: ReturnType<typeof vi.fn>
}

interface MapState {
  sources: Map<string, SourceState>
  layers: Map<string, unknown>
  renderedFeatures: unknown[]
  emit: (event: string, value?: unknown) => void
  remove: ReturnType<typeof vi.fn>
}

const mapState = vi.hoisted(() => ({
  instances: [] as unknown[],
  popupContents: [] as Node[],
}))

vi.mock('maplibre-gl', () => {
  class FakeMap {
    sources = new globalThis.Map<string, SourceState>()
    layers = new globalThis.Map<string, unknown>()
    listeners = new globalThis.Map<
      string,
      Array<(value: unknown) => void>
    >()
    remove = vi.fn()
    canvas = { style: { cursor: '' } }
    renderedFeatures: unknown[] = []

    constructor(_options: unknown) {
      mapState.instances.push(this)
    }

    addControl(_control: unknown, _position?: string) {}

    addSource(id: string, source: { data: unknown }) {
      this.sources.set(id, {
        data: source.data,
        setData: vi.fn((data: unknown) => {
          const current = this.sources.get(id)
          if (current) current.data = data
        }),
      })
    }

    addLayer(layer: { id: string }) {
      this.layers.set(layer.id, layer)
    }

    getSource(id: string) {
      return this.sources.get(id)
    }

    getLayer(id: string) {
      return this.layers.get(id)
    }

    getCanvas() {
      return this.canvas
    }

    isStyleLoaded() {
      return true
    }

    queryRenderedFeatures() {
      return this.renderedFeatures
    }

    on(event: string, handler: (value: unknown) => void) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        handler,
      ])
      return this
    }

    emit(event: string, value: unknown = {}) {
      this.listeners.get(event)?.forEach((handler) => handler(value))
    }
  }

  class FakeMarker {
    setLngLat(_coordinate: [number, number]) {
      return this
    }

    addTo(_map: unknown) {
      return this
    }

    remove() {}
  }

  class FakePopup {
    setLngLat(_coordinate: unknown) {
      return this
    }

    setDOMContent(_content: Node) {
      mapState.popupContents.push(_content)
      return this
    }

    addTo(_map: unknown) {
      return this
    }

    remove() {}
  }

  return {
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    NavigationControl: class {},
    AttributionControl: class {},
    addProtocol: vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  mapState.instances.length = 0
  mapState.popupContents.length = 0
})

describe('FieldMap operational layers', () => {
  it('loads every field-domain source and updates telemetry without rebuilding the map', () => {
    const properties = {
      fields: demoSnapshot.fields,
      ecologicalSites: demoSnapshot.ecologicalSites,
      readings: demoSnapshot.readings,
      observations: demoSnapshot.observations,
      alerts: demoSnapshot.alerts,
      insights: demoSnapshot.insights,
      contacts: demoSnapshot.contacts,
      activity: [],
      draft: null,
      onMapPress: null,
    }
    const { rerender } = render(<FieldMap {...properties} />)
    const instance = mapState.instances[0] as MapState

    act(() => instance.emit('load'))

    expect([...instance.sources.keys()]).toEqual(expect.arrayContaining([
      'fields',
      'ecological-sites',
      'readings',
      'observations',
      'monitoring-alerts',
      'al-insights',
    ]))
    expect([...instance.layers.keys()]).toEqual(expect.arrayContaining([
      'field-label',
      'ecological-site-label',
      'sensor-values',
      'observations',
      'monitoring-alerts',
      'al-insights',
    ]))

    const updatedReadings = [{
      ...properties.readings[0],
      value: properties.readings[0].value + 1,
    }]
    rerender(<FieldMap {...properties} readings={updatedReadings} />)

    expect(mapState.instances).toHaveLength(1)
    expect(instance.sources.get('readings')?.setData).toHaveBeenCalled()
    expect(
      instance.sources.get('monitoring-alerts')?.setData,
    ).toHaveBeenCalled()
    expect(instance.remove).not.toHaveBeenCalled()
  })

  it('renders open TAK shapes as lines and closed shapes as polygons', () => {
    const coordinate = {
      latitude: 39.74,
      longitude: -104.99,
      altitudeMeters: null,
      horizontalAccuracyMeters: null,
      verticalAccuracyMeters: null,
      headingDegrees: null,
    }
    const activity = [
      {
        id: 'outbound:open',
        uid: 'open',
        outboxId: null,
        direction: 'outbound' as const,
        kind: 'shape' as const,
        title: 'Fence line',
        message: null,
        coordinate,
        points: [coordinate, { ...coordinate, latitude: 39.75 }],
        closed: false,
        createdAt: '2026-07-30T10:00:00.000Z',
        staleAt: '2026-07-30T10:05:00.000Z',
        deliveryStatus: 'sent' as const,
        xml: '<event/>',
      },
      {
        id: 'outbound:closed',
        uid: 'closed',
        outboxId: null,
        direction: 'outbound' as const,
        kind: 'shape' as const,
        title: 'Treatment area',
        message: null,
        coordinate,
        points: [
          coordinate,
          { ...coordinate, latitude: 39.75 },
          { ...coordinate, longitude: -105 },
        ],
        closed: true,
        createdAt: '2026-07-30T10:00:00.000Z',
        staleAt: '2026-07-30T10:05:00.000Z',
        deliveryStatus: 'sent' as const,
        xml: '<event/>',
      },
    ]
    render(
      <FieldMap
        fields={[]}
        ecologicalSites={[]}
        readings={[]}
        observations={[]}
        alerts={[]}
        insights={[]}
        contacts={[]}
        activity={activity}
        draft={null}
        onMapPress={null}
      />,
    )
    const instance = mapState.instances[0] as MapState
    act(() => instance.emit('load'))
    const collection = instance.sources.get('tak-activity-lines')?.data as {
      features: Array<{ geometry: { type: string } }>
    }
    expect(collection.features.map((feature) => feature.geometry.type)).toEqual([
      'LineString',
      'Polygon',
    ])
  })

  it('shows tapped map details as text without interpreting record markup', () => {
    const { unmount } = render(
      <FieldMap
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        readings={demoSnapshot.readings}
        observations={[]}
        alerts={demoSnapshot.alerts}
        insights={demoSnapshot.insights}
        contacts={[]}
        activity={[]}
        draft={null}
        onMapPress={null}
      />,
    )
    const instance = mapState.instances[0] as MapState
    act(() => instance.emit('load'))
    instance.renderedFeatures = [{
      properties: {
        eyebrow: 'Field evidence',
        title: '<img src=x onerror=alert(1)>',
        detail: 'Stored offline',
      },
    }]

    act(() => instance.emit('click', {
      point: { x: 20, y: 30 },
      lngLat: { lng: -105, lat: 40 },
    }))

    const content = mapState.popupContents[0] as HTMLElement
    expect(content).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(content.querySelector('img')).toBeNull()
    unmount()
  })
})
