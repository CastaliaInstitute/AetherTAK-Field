// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { preference, share } = vi.hoisted(() => ({
  preference: new Map<string, string>(),
  share: vi.fn(),
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
  Share: { share },
}))

import { InteroperabilityEvidencePanel } from './InteroperabilityEvidencePanel'

afterEach(cleanup)

describe('interoperability evidence panel', () => {
  beforeEach(() => {
    preference.clear()
    share.mockReset()
  })

  it('creates, records, persists, and exports a physical peer session', async () => {
    const user = userEvent.setup()
    render(
      <InteroperabilityEvidencePanel defaultSenderCallsign="Field One" />,
    )

    await screen.findByRole('heading', { name: 'iTAK / ATAK test session' })
    await user.type(screen.getByLabelText('Peer version'), '2.9')
    await user.type(screen.getByLabelText('Peer device'), 'iPhone 15')
    await user.type(screen.getByLabelText('Peer OS'), 'iOS 19')
    await user.type(screen.getByLabelText('TAK Server version'), 'AetherTAK 1.0')
    await user.type(screen.getByLabelText('Peer callsign'), 'iTAK One')
    await user.click(screen.getByRole('button', { name: 'Start physical test' }))

    await screen.findByRole('heading', { name: 'iTAK 2.9' })
    const openShape = screen.getByText('Open shape').closest('details')
    expect(openShape).not.toBeNull()
    await user.click(within(openShape!).getByText('Open shape'))
    const results = within(openShape!).getAllByLabelText('Result')
    await user.selectOptions(results[0], 'pass')

    expect(await screen.findByText(/1\/24 checks recorded/)).toBeInTheDocument()
    const stored = [...preference.values()][0]
    expect(JSON.parse(stored).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'open_shape',
          direction: 'field_to_peer',
          status: 'pass',
        }),
      ]),
    )

    await user.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        dialogTitle: 'Share controlled test evidence',
      }),
    )
  })
})
