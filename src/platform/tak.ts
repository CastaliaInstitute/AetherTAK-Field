import { Capacitor, registerPlugin } from '@capacitor/core'
import type { TakConnectionState, TakContact } from '../domain/models'
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
  getStatus(): Promise<TakStatus>
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

const configuredFieldPort = Number(
  import.meta.env.VITE_AETHER_FIELD_API_PORT ?? '9443',
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
    return (await nativeTak.getContacts()).contacts
  },

  async connect(profileId?: string): Promise<TakStatus> {
    if (!Capacitor.isNativePlatform()) return browserStatus
    return nativeTak.connect(profileId ? { profileId } : {})
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
