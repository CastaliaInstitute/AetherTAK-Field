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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { preference } = vi.hoisted(() => ({
  preference: new Map<string, string>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))
vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn(async () => ({
      name: 'AetherTAK Field',
      id: 'org.castaliainstitute.aethertak.field',
      version: '0.2.0',
      build: '42',
    })),
  },
}))
vi.mock('@capacitor/device', () => ({
  Device: {
    getInfo: vi.fn(async () => ({
      platform: 'ios',
      model: 'iPhone 16 Pro',
      operatingSystem: 'ios',
      osVersion: '19.0',
      isVirtual: false,
    })),
  },
}))
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      preference.set(key, value)
    }),
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: preference.get(key) ?? null,
    })),
    remove: vi.fn(async ({ key }: { key: string }) => {
      preference.delete(key)
    }),
  },
}))
vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn() },
}))

import { PhysicalReleaseEvidencePanel } from './PhysicalReleaseEvidencePanel'

describe('PhysicalReleaseEvidencePanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    preference.clear()
  })

  it('creates a build-bound session and records controlled evidence', async () => {
    const user = userEvent.setup()
    render(<PhysicalReleaseEvidencePanel />)

    await user.type(
      await screen.findByLabelText('Controlled evidence-set reference'),
      'RC-0.2.0/ios-lidar-01',
    )
    await user.click(
      screen.getByRole('button', { name: 'Start device validation' }),
    )

    expect(await screen.findByText(/0\/15 checks evidenced/)).toBeInTheDocument()
    const certificate = screen.getByText('Certificate enrollment')
      .closest('details')
    expect(certificate).not.toBeNull()
    await user.click(within(certificate!).getByText('Certificate enrollment'))
    await user.selectOptions(
      within(certificate!).getByLabelText('Result'),
      'pass',
    )
    await user.type(
      within(certificate!).getByLabelText('Controlled evidence reference'),
      'evidence/enrollment-01',
    )
    await waitFor(() =>
      expect(screen.getByText(/1\/15 checks evidenced/)).toBeInTheDocument(),
    )
  })

  it('evaluates known-dimension depth accuracy instead of trusting a manual verdict', async () => {
    const user = userEvent.setup()
    render(<PhysicalReleaseEvidencePanel />)

    await user.type(
      await screen.findByLabelText('Controlled evidence-set reference'),
      'RC-0.2.0/ios-lidar-01',
    )
    await user.click(
      screen.getByRole('button', { name: 'Start device validation' }),
    )
    const depth = (await screen.findByText('Known-dimension depth accuracy'))
      .closest('details')
    expect(depth).not.toBeNull()
    await user.click(within(depth!).getByText('Known-dimension depth accuracy'))
    await user.type(within(depth!).getByLabelText('Known distance (m)'), '2')
    await user.type(
      within(depth!).getByLabelText('Measured distance (m)'),
      '2.08',
    )
    await user.clear(within(depth!).getByLabelText('Accepted error (%)'))
    await user.type(within(depth!).getByLabelText('Accepted error (%)'), '5')
    await user.type(
      within(depth!).getByLabelText('Measurement evidence reference'),
      'evidence/depth-ruler-01',
    )
    await user.click(
      within(depth!).getByRole('button', { name: 'Evaluate measurement' }),
    )

    expect(await screen.findByText(/4.00% error · pass/)).toBeInTheDocument()
    expect(screen.getByText(/1\/15 checks evidenced/)).toBeInTheDocument()
  })
})
