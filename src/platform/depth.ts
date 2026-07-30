import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  Coordinate,
  DepthCapability,
  DepthScanResult,
} from '../domain/models'

interface AetherDepthScannerPlugin {
  getCapability(): Promise<DepthCapability>
  startScan(options: {
    coordinate: Coordinate
    mode: 'measure' | 'point_cloud' | 'mesh'
  }): Promise<DepthScanResult>
  cancelScan(): Promise<void>
}

const nativeDepth =
  registerPlugin<AetherDepthScannerPlugin>('AetherDepthScanner')

const unsupported: DepthCapability = {
  supported: false,
  provider: 'none',
  supportsPointCloud: false,
  supportsMesh: false,
  supportsConfidence: false,
  reason: 'Depth scanning requires a compatible iOS or Android device.',
}

export const depthScanner = {
  async capability(): Promise<DepthCapability> {
    if (!Capacitor.isNativePlatform()) return unsupported
    try {
      return await nativeDepth.getCapability()
    } catch {
      return unsupported
    }
  },

  async scan(
    coordinate: Coordinate,
    mode: 'measure' | 'point_cloud' | 'mesh' = 'measure',
  ) {
    if (!Capacitor.isNativePlatform()) {
      throw new Error(unsupported.reason ?? 'Depth scanning is unavailable.')
    }
    return nativeDepth.startScan({ coordinate, mode })
  },
}
