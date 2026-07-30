import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core'
import {
  takContactSchema,
  type TakConnectionState,
  type TakContact,
} from '../domain/models'
import { operationToCot } from '../tak/cot'
import type { TakOperation } from '../tak/operations'

export interface TakServerProfile {
  id: string
  name: string
  host: string
  port: number
  callsign: string
  team: string
}

export interface TakStatus {
  state: TakConnectionState
  profile: TakServerProfile | null
  lastConnectedAt: string | null
  error: string | null
}

export interface BackgroundTrackingStatus {
  supported: boolean
  enabled: boolean
  detail: string
}

export interface CotMessage {
  uid: string
  type: string
  callsign: string
  latitude: number
  longitude: number
  altitudeMeters?: number | null
  detail?: Record<string, unknown>
  staleSeconds?: number
}

interface AetherTakTransportPlugin {
  importEnrollmentPackage(options: { path: string }): Promise<TakServerProfile>
  connect(options?: { profileId?: string }): Promise<TakStatus>
  disconnect(): Promise<void>
  removeEnrollment(): Promise<void>
  getStatus(): Promise<TakStatus>
  getBackgroundTrackingStatus(): Promise<BackgroundTrackingStatus>
  setBackgroundTracking(options: {
    enabled: boolean
  }): Promise<BackgroundTrackingStatus>
  getContacts(): Promise<{ contacts: TakContact[] }>
  sendCot(options: { xml: string }): Promise<{ accepted: boolean }>
  fieldMutation(options: {
    port: number
    mutation: Record<string, unknown>
  }): Promise<NativeFieldResponse>
  fieldChanges(options: {
    port: number
    cursor: number
    limit: number
  }): Promise<NativeFieldResponse>
  fieldUpload(options: {
    port: number
    mediaId: string
    uri: string
    contentType: string
    observationId?: string
    role?: string
    sha256?: string
  }): Promise<NativeFieldResponse>
  fieldDownload(options: {
    port: number
    mediaId: string
    expectedSha256?: string
    expectedContentType?: string
  }): Promise<NativeFieldResponse>
  missionPackageUpload(options: {
    port: number
    uri: string
    fileName: string
    creatorUid: string
  }): Promise<MissionPackageUploadResult>
  missionPackageDownload(options: {
    port: number
    senderUrl: string
    fileName: string
    expectedSha256: string
    expectedSizeBytes: number
  }): Promise<MissionPackageDownloadResult>
  addListener(
    eventName: 'cotEvent',
    listener: (event: { xml: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'statusChanged',
    listener: (event: TakStatus) => void,
  ): Promise<PluginListenerHandle>
}

export interface MissionPackageUploadResult {
  senderUrl: string
  sha256: string
  sizeBytes: number
}

export interface MissionPackageDownloadResult {
  localUri: string
  sha256: string
  sizeBytes: number
  fileName: string
}

export interface NativeFieldResponse {
  status: number
  body: Record<string, unknown>
}

const nativeTak = registerPlugin<AetherTakTransportPlugin>('AetherTakTransport')

const browserStatus: TakStatus = {
  state: 'disconnected',
  profile: {
    id: 'browser-preview',
    name: 'AetherTAK',
    host: '192.168.86.69',
    port: 8089,
    callsign: 'Field Preview',
    team: 'Green',
  },
  lastConnectedAt: null,
  error: 'Native TAK transport is available in the iOS and Android builds.',
}

const browserBackgroundTracking: BackgroundTrackingStatus = {
  supported: false,
  enabled: false,
  detail: 'Background team tracking requires the iOS or Android application.',
}

const configuredFieldPort = Number(
  import.meta.env.VITE_AETHER_FIELD_API_PORT ?? '9443',
)
const configuredMissionPackagePort = Number(
  import.meta.env.VITE_TAK_MISSION_PACKAGE_PORT ?? '8443',
)

function fieldPort() {
  if (
    !Number.isInteger(configuredFieldPort) ||
    configuredFieldPort < 1 ||
    configuredFieldPort > 65_535
  ) {
    throw new Error('VITE_AETHER_FIELD_API_PORT must be a valid TCP port.')
  }
  return configuredFieldPort
}

function missionPackagePort() {
  if (
    !Number.isInteger(configuredMissionPackagePort) ||
    configuredMissionPackagePort < 1 ||
    configuredMissionPackagePort > 65_535
  ) {
    throw new Error('VITE_TAK_MISSION_PACKAGE_PORT must be a valid TCP port.')
  }
  return configuredMissionPackagePort
}

function requireNativeFieldApi() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      'Secure Aether Field synchronization requires the iOS or Android application.',
    )
  }
}

export const takTransport = {
  isNative: () => Capacitor.isNativePlatform(),

  async status(): Promise<TakStatus> {
    return Capacitor.isNativePlatform() ? nativeTak.getStatus() : browserStatus
  },

  async importEnrollmentPackage(path: string): Promise<TakServerProfile> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error(
        'TAK certificate enrollment requires the iOS or Android application.',
      )
    }
    return nativeTak.importEnrollmentPackage({ path })
  },

  async contacts(): Promise<TakContact[]> {
    if (!Capacitor.isNativePlatform()) return []
    return (await nativeTak.getContacts()).contacts.flatMap((contact) => {
      const parsed = takContactSchema.safeParse(contact)
      return parsed.success ? [parsed.data] : []
    })
  },

  async connect(profileId?: string): Promise<TakStatus> {
    if (!Capacitor.isNativePlatform()) return browserStatus
    return nativeTak.connect(profileId ? { profileId } : {})
  },

  async removeEnrollment(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error(
        'TAK enrollment removal requires the iOS or Android application.',
      )
    }
    await nativeTak.removeEnrollment()
  },

  async backgroundTrackingStatus(): Promise<BackgroundTrackingStatus> {
    if (!Capacitor.isNativePlatform()) return browserBackgroundTracking
    return nativeTak.getBackgroundTrackingStatus()
  },

  async setBackgroundTracking(
    enabled: boolean,
  ): Promise<BackgroundTrackingStatus> {
    if (!Capacitor.isNativePlatform()) return browserBackgroundTracking
    return nativeTak.setBackgroundTracking({ enabled })
  },

  async sendXml(xml: string): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false
    return (await nativeTak.sendCot({ xml })).accepted
  },

  async sendOperation(operation: TakOperation): Promise<boolean> {
    return this.sendXml(operationToCot(operation))
  },

  async send(message: CotMessage): Promise<boolean> {
    const operation: TakOperation = {
      kind: 'marker',
      uid: message.uid,
      callsign: message.callsign,
      coordinate: {
        latitude: message.latitude,
        longitude: message.longitude,
        altitudeMeters: message.altitudeMeters ?? null,
        horizontalAccuracyMeters: null,
        verticalAccuracyMeters: null,
        headingDegrees: null,
      },
      cotType: message.type,
      createdAt: new Date().toISOString(),
      staleSeconds: message.staleSeconds,
    }
    return this.sendOperation(operation)
  },

  async onCotEvent(
    listener: (xml: string) => void,
  ): Promise<PluginListenerHandle | null> {
    if (!Capacitor.isNativePlatform()) return null
    return nativeTak.addListener('cotEvent', (event) => listener(event.xml))
  },

  async onStatusChange(
    listener: (status: TakStatus) => void,
  ): Promise<PluginListenerHandle | null> {
    if (!Capacitor.isNativePlatform()) return null
    return nativeTak.addListener('statusChanged', listener)
  },

  async uploadMissionPackage(options: {
    uri: string
    fileName: string
    creatorUid: string
  }): Promise<MissionPackageUploadResult> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error(
        'TAK mission-package upload requires the iOS or Android application.',
      )
    }
    return nativeTak.missionPackageUpload({
      port: missionPackagePort(),
      ...options,
    })
  },

  async downloadMissionPackage(options: {
    senderUrl: string
    fileName: string
    expectedSha256: string
    expectedSizeBytes: number
  }): Promise<MissionPackageDownloadResult> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error(
        'TAK mission-package download requires the iOS or Android application.',
      )
    }
    return nativeTak.missionPackageDownload({
      port: missionPackagePort(),
      ...options,
    })
  },
}

export const fieldApiTransport = {
  async mutate(
    mutation: Record<string, unknown>,
  ): Promise<NativeFieldResponse> {
    requireNativeFieldApi()
    return nativeTak.fieldMutation({ port: fieldPort(), mutation })
  },

  async changes(cursor: number, limit = 100): Promise<NativeFieldResponse> {
    requireNativeFieldApi()
    return nativeTak.fieldChanges({ port: fieldPort(), cursor, limit })
  },

  async upload(options: {
    mediaId: string
    uri: string
    contentType: string
    observationId?: string
    role?: string
    sha256?: string
  }): Promise<NativeFieldResponse> {
    requireNativeFieldApi()
    return nativeTak.fieldUpload({ port: fieldPort(), ...options })
  },

  async download(options: {
    mediaId: string
    expectedSha256?: string
    expectedContentType?: string
  }): Promise<NativeFieldResponse> {
    requireNativeFieldApi()
    return nativeTak.fieldDownload({ port: fieldPort(), ...options })
  },
}
