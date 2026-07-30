// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaCapture, Observation } from '../domain/models'
import { demoSnapshot } from '../domain/seed'
import { ObservationDetail } from './ObservationDetail'

const { shareArtifact } = vi.hoisted(() => ({
  shareArtifact: vi.fn(),
}))

vi.mock('../media/artifactSharing', () => ({
  artifactSharing: {
    canShare: () => true,
    share: shareArtifact,
  },
}))

const observation: Observation = {
  id: '12cff24a-35b4-4f77-9c42-ecb8f8d5973d',
  fieldId: demoSnapshot.fields[0].id,
  siteId: null,
  category: 'crop',
  title: 'Lettuce canopy scan',
  notes: 'Check the west edge after irrigation.',
  coordinate: {
    latitude: 39.741,
    longitude: -104.995,
    altitudeMeters: 1609,
    horizontalAccuracyMeters: 2.5,
    verticalAccuracyMeters: 4,
    headingDegrees: 90,
  },
  observedAt: '2026-07-30T12:00:00.000Z',
  mediaIds: [
    'e38806fc-568d-408c-aa05-7916eaa04f6f',
    '0459771a-6f27-4e19-9fdd-a62dad4ea89e',
  ],
  syncState: 'queued',
}

const depth: MediaCapture = {
  id: observation.mediaIds[0],
  observationId: observation.id,
  kind: 'depth',
  localUri: 'file:///depth.bin',
  previewUri: 'data:image/jpeg;base64,AA==',
  mimeType: 'application/x-aether-depth-f32le',
  coordinate: observation.coordinate,
  capturedAt: observation.observedAt,
  deviceModel: 'iPhone',
  sha256: 'a'.repeat(64),
  depthMetadata: {
    scanId: 'b0088043-cf69-42f5-9946-0e2a2d90a15d',
    provider: 'arkit-lidar',
    role: 'depth',
    measurements: [
      { label: 'Median range', value: 1.82, unit: 'm', uncertainty: 0.08 },
    ],
  },
  syncState: 'queued',
}

afterEach(() => {
  cleanup()
  shareArtifact.mockReset()
})

describe('ObservationDetail', () => {
  it('renders assignment, geotag, depth measurement, and missing media state', () => {
    render(
      <ObservationDetail
        observation={observation}
        media={[depth]}
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: /Lettuce canopy scan/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/North Market Beds/)).toBeInTheDocument()
    expect(screen.getByText('39.741000')).toBeInTheDocument()
    expect(screen.getByText(/1.82 m ±0.08/)).toBeInTheDocument()
    expect(screen.getByText('iPhone')).toBeInTheDocument()
    expect(screen.getByText('Artifact unavailable')).toBeInTheDocument()
    expect(screen.getByText(/SHA-256 aaaaaaaaaaaa/)).toBeInTheDocument()
  })

  it('opens the verified local artifact through the native share sheet', async () => {
    shareArtifact.mockResolvedValue(undefined)
    render(
      <ObservationDetail
        observation={observation}
        media={[depth]}
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Open or share metric depth' }),
    )
    expect(shareArtifact).toHaveBeenCalledWith(depth, observation)
  })

  it('reports a native share-sheet failure without losing the evidence view', async () => {
    shareArtifact.mockRejectedValue(new Error('Share sheet unavailable.'))
    render(
      <ObservationDetail
        observation={observation}
        media={[depth]}
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Open or share metric depth' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Share sheet unavailable.',
    )
    expect(screen.getByText(/SHA-256 aaaaaaaaaaaa/)).toBeInTheDocument()
  })

  it('closes from the explicit dialog control', async () => {
    const onClose = vi.fn()
    render(
      <ObservationDetail
        observation={observation}
        media={[depth]}
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        onClose={onClose}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Close observation' }),
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('supports the platform escape gesture and focuses the close control', async () => {
    const onClose = vi.fn()
    render(
      <ObservationDetail
        observation={observation}
        media={[depth]}
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        onClose={onClose}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Close observation' }),
    ).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
