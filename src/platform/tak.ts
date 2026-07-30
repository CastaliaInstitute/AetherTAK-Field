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
