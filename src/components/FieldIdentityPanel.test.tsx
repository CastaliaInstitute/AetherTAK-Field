// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FieldIdentityPanel } from './FieldIdentityPanel'

afterEach(cleanup)

describe('FieldIdentityPanel', () => {
  it('shows the exact authenticated certificate identity and effective roles', async () => {
    const user = userEvent.setup()
    const verify = vi.fn().mockResolvedValue({
      authenticated: true,
      commonName: 'Field Supervisor',
      permissions: {
        publisher: false,
        guardianCheckIn: true,
        guardianSupervisor: true,
      },
    })
    render(<FieldIdentityPanel verify={verify} />)

    await user.click(
      screen.getByRole('button', { name: 'Verify certificate role' }),
    )

    expect(verify).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Field Supervisor')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Guardian supervisor',
    )
    expect(screen.queryByText('Field publisher')).not.toBeInTheDocument()
  })

  it('does not retain a stale identity after verification fails', async () => {
    const user = userEvent.setup()
    const verify = vi.fn()
      .mockResolvedValueOnce({
        authenticated: true,
        commonName: 'Field One',
        permissions: {
          publisher: false,
          guardianCheckIn: false,
          guardianSupervisor: false,
        },
      })
      .mockRejectedValueOnce(new Error('Identity endpoint unavailable.'))
    render(<FieldIdentityPanel verify={verify} />)
    const button = screen.getByRole('button', {
      name: 'Verify certificate role',
    })

    await user.click(button)
    expect(screen.getByRole('status')).toHaveTextContent('Field One')
    await user.click(button)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Identity endpoint unavailable.',
    )
  })
})
