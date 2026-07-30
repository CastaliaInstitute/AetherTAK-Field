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

export type TakOperation =
  | PositionOperation
  | ChatOperation
  | MarkerOperation
  | RouteOperation
  | ShapeOperation
  | EmergencyOperation

export type TakOperationKind = TakOperation['kind']
