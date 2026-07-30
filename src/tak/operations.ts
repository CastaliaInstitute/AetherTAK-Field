import type { Coordinate } from '../domain/models'

export interface TakIdentity {
  uid: string
  callsign: string
  team: string
  role: 'Team Member' | 'Team Lead' | 'HQ' | 'K9'
}

interface OperationBase {
  uid: string
  createdAt: string
  staleSeconds?: number
}

export interface PositionOperation extends OperationBase {
  kind: 'position'
  identity: TakIdentity
  coordinate: Coordinate
  speedMetersPerSecond?: number
}

export interface ChatOperation extends OperationBase {
  kind: 'chat'
  sender: TakIdentity
  recipientUid: string
  conversationId: string
  conversationName: string
  message: string
}

export interface MarkerOperation extends OperationBase {
  kind: 'marker'
  callsign: string
  coordinate: Coordinate
  cotType?: string
  remarks?: string
}

export interface RouteOperation extends OperationBase {
  kind: 'route'
  title: string
  colorArgb: number
  points: Coordinate[]
}

export interface ShapeOperation extends OperationBase {
  kind: 'shape'
  title: string
  colorArgb: number
  closed: boolean
  points: Coordinate[]
}

export interface EmergencyOperation extends OperationBase {
  kind: 'emergency'
  identity: TakIdentity
  coordinate: Coordinate
  emergencyType:
    | '911 Alert'
    | 'Cancel'
    | 'Geo-fence Breached'
    | 'In Contact'
    | 'Medical'
    | 'Ring The Bell'
}

export interface MissionPackageUpload {
  senderUrl: string
  sha256: string
  sizeBytes: number
}

export interface MissionPackageOperation extends OperationBase {
  kind: 'missionPackage'
  sender: TakIdentity
  recipientUid: string
  recipientCallsign: string
  transferName: string
  fileName: string
  localUri: string
  storagePath: string
  coordinate: Coordinate
  ackUid: string
  upload: MissionPackageUpload | null
}

export interface MissionPackageAckOperation extends OperationBase {
  kind: 'missionPackageAck'
  sender: TakIdentity
  recipientCallsign: string
  coordinate: Coordinate
  ackUid: string
  transferName: string
  sha256: string
  sizeBytes: number
  success: boolean
  reason: string
}

export type TakOperation =
  | PositionOperation
  | ChatOperation
  | MarkerOperation
  | RouteOperation
  | ShapeOperation
  | EmergencyOperation
  | MissionPackageOperation
  | MissionPackageAckOperation

export type TakOperationKind = TakOperation['kind']
