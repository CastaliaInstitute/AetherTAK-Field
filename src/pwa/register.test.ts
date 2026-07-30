import { describe, expect, it, vi } from 'vitest'
import { registerPwaServiceWorker } from './register'

describe('PWA registration', () => {
  it('registers the root-scoped shell worker in the web client', async () => {
    const registration = { scope: 'https://field.example.test/' }
    const register = vi.fn(async () => registration)

    await expect(
      registerPwaServiceWorker({
        native: false,
        serviceWorker: { register },
      }),
    ).resolves.toBe(registration)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('never registers a service worker inside Capacitor', async () => {
    const register = vi.fn()

    await expect(
      registerPwaServiceWorker({
        native: true,
        serviceWorker: { register },
      }),
    ).resolves.toBeNull()
    expect(register).not.toHaveBeenCalled()
  })

  it('degrades safely when service workers are unavailable', async () => {
    await expect(
      registerPwaServiceWorker({
        native: false,
        serviceWorker: null,
      }),
    ).resolves.toBeNull()
  })
})
