import { Capacitor } from '@capacitor/core'

export interface PwaRegistrationOptions {
  native?: boolean
  serviceWorker?: {
    register(
      scriptURL: string | URL,
      options?: RegistrationOptions,
    ): Promise<unknown>
  } | null
}

export async function registerPwaServiceWorker(
  options: PwaRegistrationOptions = {},
) {
  const native = options.native ?? Capacitor.isNativePlatform()
  const serviceWorker =
    options.serviceWorker !== undefined
      ? options.serviceWorker
      : typeof navigator === 'undefined'
        ? null
        : navigator.serviceWorker
  if (native || !serviceWorker) return null
  return serviceWorker.register('/sw.js', { scope: '/' })
}
