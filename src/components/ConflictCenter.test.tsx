// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OutboxItem } from '../data/database'
import { demoSnapshot } from '../domain/seed'
import { ConflictCenter } from './ConflictCenter'

const conflict: OutboxItem = {
  id: '478d5818-9447-424c-9183-5d455573bf82',
  entityType: 'field',
  entityId: demoSnapshot.fields[0].id,
  operation: 'update',
  payload: { ...demoSnapshot.fields[0], name: 'Device Beds' },
  createdAt: '2026-07-30T12:00:00.000Z',
  attempts: 1,
  lastError: 'revision conflict',
  baseRevision: 2,
  nextAttemptAt: '9999-12-31T23:59:59.999Z',
  conflict: {
    entityType: 'field',
    entityId: demoSnapshot.fields[0].id,
    revision: 3,
    deleted: false,
    payload: { ...demoSnapshot.fields[0], name: 'Server Beds' },
    updatedAt: '2026-07-30T12:01:00.000Z',
    author: 'Field Two',
  },
}

afterEach(cleanup)

describe('ConflictCenter', () => {
  it('requires confirmation before overwriting the server', async () => {
    const onResolve = vi.fn(async () => undefined)
    const onNotice = vi.fn()
    render(
      <ConflictCenter
        conflicts={[conflict]}
        onResolve={onResolve}
        onNotice={onNotice}
      />,
    )

    expect(screen.getByText('Device Beds')).toBeInTheDocument()
    expect(screen.getByText('Server Beds')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Keep this device' }),
    )
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByText(/Overwrite the current server record/)).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm resolution' }),
    )
    expect(onResolve).toHaveBeenCalledWith(conflict.id, 'keep_device')
    expect(onNotice).toHaveBeenCalledWith(
      expect.stringContaining('queued to overwrite the server'),
    )
  })

  it('labels a server tombstone as an explicit deletion decision', async () => {
    render(
      <ConflictCenter
        conflicts={[
          {
            ...conflict,
            conflict: { ...conflict.conflict!, deleted: true, payload: null },
          },
        ]}
        onResolve={vi.fn(async () => undefined)}
        onNotice={vi.fn()}
      />,
    )

    expect(screen.getByText('Deleted on server')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Accept deletion' }))
    expect(
      screen.getByText(/Accept the server deletion and discard/),
    ).toBeInTheDocument()
  })
})
