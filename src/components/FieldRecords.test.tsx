// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaCapture, Observation } from '../domain/models'
import { demoSnapshot } from '../domain/seed'
import type { FieldDashboard } from '../data/useDashboard'
import { FieldRecords } from './FieldRecords'

const observation: Observation = {
  id: '0d58e285-d604-4daa-875a-56d72c7ee392',
  fieldId: demoSnapshot.fields[0].id,
  siteId: null,
  category: 'damage',
  title: 'Hail damage',
  notes: 'Review before harvest.',
  coordinate: demoSnapshot.properties[0].center,
  observedAt: '2026-07-30T12:00:00.000Z',
  mediaIds: ['2f30a4ef-c417-478d-8a23-1f43ee71eb5e'],
  syncState: 'queued',
}

const photo: MediaCapture = {
  id: observation.mediaIds[0],
  observationId: observation.id,
  kind: 'photo',
  localUri: 'file:///private/hail.jpg',
  previewUri: 'data:image/jpeg;base64,AA==',
  mimeType: 'image/jpeg',
  coordinate: observation.coordinate,
  capturedAt: observation.observedAt,
  deviceModel: null,
  sha256: null,
  depthMetadata: null,
  syncState: 'queued',
}

const dashboard: FieldDashboard = {
  properties: demoSnapshot.properties,
  seasons: demoSnapshot.seasons,
  fields: demoSnapshot.fields,
  ecologicalSites: demoSnapshot.ecologicalSites,
  readings: demoSnapshot.readings,
  observations: [observation],
  media: [photo],
  alerts: demoSnapshot.alerts,
  insights: demoSnapshot.insights,
  guardianParticipants: demoSnapshot.guardianParticipants,
  guardianAlerts: demoSnapshot.guardianAlerts,
  guardianZones: demoSnapshot.guardianZones,
  guardianActions: [],
  conflicts: [],
  offlineMapRegions: [],
}

afterEach(cleanup)

describe('FieldRecords evidence review', () => {
  it('opens a persisted observation from the records list', async () => {
    render(<FieldRecords data={dashboard} onNotice={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /Hail damage/ }))

    expect(
      screen.getByRole('dialog', { name: /Hail damage/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByAltText('Photo observation preview'),
    ).toHaveAttribute('src', 'data:image/jpeg;base64,AA==')
  })
})
