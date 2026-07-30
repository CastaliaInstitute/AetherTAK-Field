// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSnapshot } from '../domain/seed'
import type { DepthCapability } from '../domain/models'
import { CapturePanel } from './CapturePanel'

const supportedDepth: DepthCapability = {
  supported: true,
  provider: 'arkit-lidar',
  supportsPointCloud: true,
  supportsMesh: true,
  supportsConfidence: true,
  reason: null,
}

afterEach(cleanup)

describe('structured observation capture', () => {
  it('assigns a categorized photo to an ecological site', async () => {
    const user = userEvent.setup()
    const onPhoto = vi.fn(async () => undefined)
    render(
      <CapturePanel
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        depth={supportedDepth}
        onPhoto={onPhoto}
        onVideo={vi.fn()}
        onDepth={vi.fn()}
      />,
    )

    const site = demoSnapshot.ecologicalSites[0]
    await user.selectOptions(
      screen.getByLabelText('Assign observation to'),
      `site:${site.id}`,
    )
    await user.selectOptions(
      screen.getByLabelText('Observation category'),
      'habitat',
    )
    await user.type(
      screen.getByPlaceholderText('What are you documenting?'),
      'Willow recruitment',
    )
    await user.type(
      screen.getByPlaceholderText(
        'Condition, treatment, species, damage, or follow-up',
      ),
      'Three new stems above the browse line.',
    )
    await user.click(
      screen.getByRole('button', { name: 'Take geotagged photo' }),
    )

    await waitFor(() =>
      expect(onPhoto).toHaveBeenCalledWith({
        fieldId: null,
        siteId: site.id,
        category: 'habitat',
        title: 'Willow recruitment',
        notes: 'Three new stems above the browse line.',
      }),
    )
  })

  it('offers capability-filtered depth output and passes the selected mode', async () => {
    const user = userEvent.setup()
    const onDepth = vi.fn(async () => undefined)
    render(
      <CapturePanel
        fields={demoSnapshot.fields}
        ecologicalSites={demoSnapshot.ecologicalSites}
        depth={{ ...supportedDepth, supportsMesh: false }}
        onPhoto={vi.fn()}
        onVideo={vi.fn()}
        onDepth={onDepth}
      />,
    )

    expect(
      screen.queryByRole('option', { name: 'Measurements + 3D model' }),
    ).not.toBeInTheDocument()
    await user.selectOptions(
      screen.getByLabelText('Depth output'),
      'point_cloud',
    )
    await user.type(
      screen.getByPlaceholderText('What are you documenting?'),
      'Erosion bank profile',
    )
    await user.click(
      screen.getByRole('button', { name: 'Start arkit-lidar scan' }),
    )

    await waitFor(() =>
      expect(onDepth).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'crop',
          title: 'Erosion bank profile',
        }),
        'point_cloud',
      ),
    )
  })

  it('blocks untitled captures and unsupported depth scans', async () => {
    const user = userEvent.setup()
    const onPhoto = vi.fn()
    render(
      <CapturePanel
        fields={[]}
        ecologicalSites={[]}
        depth={{
          supported: false,
          provider: 'none',
          supportsPointCloud: false,
          supportsMesh: false,
          supportsConfidence: false,
          reason: 'No supported depth sensor.',
        }}
        onPhoto={onPhoto}
        onVideo={vi.fn()}
        onDepth={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Depth unavailable on this device',
      }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Take geotagged photo' }),
    )
    expect(onPhoto).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Give this observation a title before capturing evidence.',
      ),
    ).toBeInTheDocument()
  })
})
