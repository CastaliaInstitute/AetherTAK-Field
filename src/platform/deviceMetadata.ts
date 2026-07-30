import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import type { TakDeviceMetadata } from '../tak/operations'

let appVersionPromise: Promise<string> | null = null

function appVersion() {
  appVersionPromise ??= App.getInfo().then((info) => info.version)
  return appVersionPromise
}

export function batteryPercent(level: number | undefined): number | null {
  if (level === undefined || !Number.isFinite(level)) return null
  return Math.min(100, Math.max(0, Math.round(level * 100)))
}

function platformName(value: string) {
  if (value === 'ios') return 'iOS'
  if (value === 'android') return 'Android'
  return value || 'Capacitor'
}

export function createDeviceModelProvider(
  isNative: () => boolean,
  getInfo: () => Promise<{ model?: string }>,
) {
  return async (): Promise<string | null> => {
    if (!isNative()) return null
    try {
      const model = (await getInfo()).model?.trim()
      return model || null
    } catch {
      return null
    }
  }
}

export const currentDeviceModel = createDeviceModelProvider(
  () => Capacitor.isNativePlatform(),
  () => Device.getInfo(),
)

export async function currentTakDeviceMetadata(): Promise<TakDeviceMetadata> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('TAK device metadata requires the native application.')
  }
  const [version, info, battery] = await Promise.all([
    appVersion(),
    Device.getInfo(),
    Device.getBatteryInfo(),
  ])
  return {
    model: info.model || 'AetherTAK Field',
    platform: platformName(info.operatingSystem),
    osVersion: info.osVersion || 'unknown',
    appVersion: version || 'unknown',
    batteryPercent: batteryPercent(battery.batteryLevel),
  }
}
