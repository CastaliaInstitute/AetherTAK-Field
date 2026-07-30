// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FieldDashboard } from '../data/useDashboard'
import { saveLocalEntity } from '../data/fieldRepository'
import { boundaryAreaHectares } from '../domain/boundary'
import { demoSnapshot } from '../domain/seed'
import { FieldRecords } from './FieldRecords'

vi.mock('../data/fieldRepository', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../data/fieldRepository')>()
  return { ...original, saveLocalEntity: vi.fn() }
})

const dashboard: FieldDashboard = {
  properties: demoSnapshot.properties,
  seasons: demoSnapshot.seasons,
  fields: demoSnapshot.fields,
  ecologicalSites: demoSnapshot.ecologicalSites,
  readings: demoSnapshot.readings,
  observations: demoSnapshot.observations,
  media: [],
  alerts: demoSnapshot.alerts,
  insights: demoSnapshot.insights,
  conflicts: [],
  offlineMapRegions: [],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function enterNewField(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Crop field/ }))
  await user.type(screen.getByLabelText('Field name'), 'South greens')
  await user.type(screen.getByLabelText('Crop'), 'Kale')
}

describe('FieldRecords boundaries', () => {
  it('refuses to save a crop field without a valid boundary', async () => {
    const user = userEvent.setup()
    render(<FieldRecords data={dashboard} onNotice={vi.fn()} />)

    await enterNewField(user)
    await user.click(screen.getByRole('button', { name: 'Save and sync' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add at least three distinct boundary vertices.',
    )
    expect(saveLocalEntity).not.toHaveBeenCalled()
  })

  it('saves an explicitly chosen closed starter boundary for offline sync', async () => {
    const user = userEvent.setup()
    render(<FieldRecords data={dashboard} onNotice={vi.fn()} />)

    await enterNewField(user)
    await user.click(
      screen.getByRole('button', { name: '100 m starter square' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save and sync' }))

    await waitFor(() => expect(saveLocalEntity).toHaveBeenCalledOnce())
    const entity = vi.mocked(saveLocalEntity).mock.calls[0][0]
    expect(entity.type).toBe('field')
    if (entity.type !== 'field') throw new Error('Expected a field mutation.')
    expect(entity.value.propertyId).toBe(dashboard.properties[0].id)
    expect(entity.value.seasonId).toBe(dashboard.seasons[0].id)
    expect(entity.value.boundary[0]).toEqual(entity.value.boundary.at(-1))
    expect(entity.value.boundary).toHaveLength(5)
    expect(boundaryAreaHectares(entity.value.boundary)).toBeCloseTo(1, 2)
  })

  it('only offers seasons belonging to the selected property', async () => {
    const user = userEvent.setup()
    const secondProperty = {
      ...dashboard.properties[0],
      id: '67666586-ec94-4ccc-9988-04e580f4c76d',
      name: 'East Farm',
    }
    const secondSeason = {
      ...dashboard.seasons[0],
      id: 'ee0ada4e-4170-466c-9dd3-1a861805583a',
      propertyId: secondProperty.id,
      name: 'East 2027',
    }
    render(
      <FieldRecords
        data={{
          ...dashboard,
          properties: [...dashboard.properties, secondProperty],
          seasons: [...dashboard.seasons, secondSeason],
        }}
        onNotice={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Crop field/ }))
    await user.selectOptions(screen.getByLabelText('Property'), secondProperty.id)

    const seasonSelect = screen.getByLabelText('Season')
    expect(within(seasonSelect).getByRole('option', {
      name: secondSeason.name,
    })).toBeInTheDocument()
    expect(within(seasonSelect).queryByRole('option', {
      name: dashboard.seasons[0].name,
    })).not.toBeInTheDocument()
    expect(seasonSelect).toHaveValue(secondSeason.id)
  })

  it('derives an ecological-site center from its saved boundary', async () => {
    const user = userEvent.setup()
    render(<FieldRecords data={dashboard} onNotice={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Ecology/ }))
    await user.type(screen.getByLabelText('Site name'), 'Pollinator edge')
    await user.click(
      screen.getByRole('button', { name: '100 m starter square' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save and sync' }))

    await waitFor(() => expect(saveLocalEntity).toHaveBeenCalledOnce())
    const entity = vi.mocked(saveLocalEntity).mock.calls[0][0]
    expect(entity.type).toBe('ecological_site')
    if (entity.type !== 'ecological_site') {
      throw new Error('Expected an ecological-site mutation.')
    }
    expect(entity.value.center.latitude).toBeCloseTo(
      dashboard.properties[0].center.latitude,
      6,
    )
    expect(entity.value.center.longitude).toBeCloseTo(
      dashboard.properties[0].center.longitude,
      6,
    )
    expect(entity.value.boundary[0]).toEqual(entity.value.boundary.at(-1))
  })
})
