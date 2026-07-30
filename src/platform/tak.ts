import { Capacitor, registerPlugin } from '@capacitor/core'
import type { TakConnectionState, TakContact } from '../domain/models'

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
  sendCot(options: { message: CotMessage }): Promise<{ accepted: boolean }>
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

  async contacts(): Promise<TakContact[]> {
    if (!Capacitor.isNativePlatform()) return []
    return (await nativeTak.getContacts()).contacts
  },

  async connect(profileId?: string): Promise<TakStatus> {
    if (!Capacitor.isNativePlatform()) return browserStatus
    return nativeTak.connect(profileId ? { profileId } : {})
  },

  async send(message: CotMessage): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false
    return (await nativeTak.sendCot({ message })).accepted
  },
}
