import { z } from 'zod'

export const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitudeMeters: z.number().nullable().default(null),
  horizontalAccuracyMeters: z.number().nonnegative().nullable().default(null),
  verticalAccuracyMeters: z.number().nonnegative().nullable().default(null),
  headingDegrees: z.number().min(0).max(360).nullable().default(null),
})

export type Coordinate = z.infer<typeof coordinateSchema>

export const fieldSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  name: z.string().min(1),
  crop: z.string().min(1),
  cropIcon: z.string().min(1),
  variety: z.string().nullable(),
  seasonLabel: z.string().min(1),
  status: z.enum(['planned', 'growing', 'attention', 'harvested']),
  healthScore: z.number().min(0).max(100).nullable(),
  boundary: z.array(z.tuple([z.number(), z.number()])).min(3),
  updatedAt: z.string().datetime(),
})

export type Field = z.infer<typeof fieldSchema>

export const sensorReadingSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().min(1),
  fieldId: z.string().uuid().nullable(),
  siteId: z.string().uuid().nullable(),
  label: z.string().min(1),
  measurement: z.enum([
    'soil_moisture',
    'air_temperature',
    'soil_temperature',
    'humidity',
    'water_level',
    'conductivity',
    'ph',
  ]),
  value: z.number(),
  unit: z.string().min(1),
  quality: z.enum(['good', 'estimated', 'suspect']),
  coordinate: coordinateSchema,
  recordedAt: z.string().datetime(),
})

export type SensorReading = z.infer<typeof sensorReadingSchema>

export const observationSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid().nullable(),
  fieldId: z.string().uuid().nullable(),
  category: z.enum(['crop', 'species', 'habitat', 'water', 'soil', 'damage']),
  title: z.string().min(1),
  notes: z.string(),
  coordinate: coordinateSchema,
  observedAt: z.string().datetime(),
  mediaIds: z.array(z.string().uuid()),
  syncState: z.enum(['local', 'queued', 'synced', 'conflict']),
})

export type Observation = z.infer<typeof observationSchema>

export const mediaCaptureSchema = z.object({
  id: z.string().uuid(),
  observationId: z.string().uuid().nullable(),
  kind: z.enum(['photo', 'video', 'depth', 'point_cloud', 'model']),
  localUri: z.string().min(1),
  previewUri: z.string().nullable(),
  mimeType: z.string().min(1),
  coordinate: coordinateSchema,
  capturedAt: z.string().datetime(),
  deviceModel: z.string().nullable(),
  sha256: z.string().nullable(),
  syncState: z.enum(['local', 'queued', 'synced']),
})

export type MediaCapture = z.infer<typeof mediaCaptureSchema>

export const alertSchema = z.object({
  id: z.string().uuid(),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string().min(1),
  detail: z.string(),
  fieldId: z.string().uuid().nullable(),
  deviceId: z.string().nullable(),
  createdAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
})

export type Alert = z.infer<typeof alertSchema>

export type TakConnectionState =
  | 'not_enrolled'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded'

export interface TakContact {
  uid: string
  callsign: string
  team: string | null
  coordinate: Coordinate
  staleAt: string
}

export interface DepthCapability {
  supported: boolean
  provider: 'arkit-lidar' | 'arcore-depth' | 'none'
  supportsPointCloud: boolean
  supportsMesh: boolean
  supportsConfidence: boolean
  reason: string | null
}

export interface DepthScanResult {
  id: string
  provider: Exclude<DepthCapability['provider'], 'none'>
  capturedAt: string
  coordinate: Coordinate
  previewUri: string
  depthUri: string
  confidenceUri: string | null
  pointCloudUri: string | null
  modelUri: string | null
  measurements: Array<{
    label: string
    value: number
    unit: 'm' | 'm2' | 'm3'
    uncertainty: number | null
  }>
}

export interface DashboardSnapshot {
  fields: Field[]
  readings: SensorReading[]
  observations: Observation[]
  alerts: Alert[]
  contacts: TakContact[]
}

