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

export const syncStateSchema = z.enum([
  'local',
  'queued',
  'synced',
  'conflict',
])

export const propertySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  center: coordinateSchema,
  boundary: z.array(z.tuple([z.number(), z.number()])).min(3),
  timezone: z.string().min(1),
  updatedAt: z.string().datetime(),
  syncState: syncStateSchema,
})

export type Property = z.infer<typeof propertySchema>

export const seasonSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  name: z.string().min(1),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  status: z.enum(['planned', 'active', 'closed']),
  notes: z.string(),
  updatedAt: z.string().datetime(),
  syncState: syncStateSchema,
})

export type Season = z.infer<typeof seasonSchema>

export const fieldSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  seasonId: z.string().uuid(),
  name: z.string().min(1),
  crop: z.string().min(1),
  cropIcon: z.string().min(1),
  variety: z.string().nullable(),
  seasonLabel: z.string().min(1),
  status: z.enum(['planned', 'growing', 'attention', 'harvested']),
  healthScore: z.number().min(0).max(100).nullable(),
  boundary: z.array(z.tuple([z.number(), z.number()])).min(3),
  updatedAt: z.string().datetime(),
  syncState: syncStateSchema,
})

export type Field = z.infer<typeof fieldSchema>

export const ecologicalSiteSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  name: z.string().min(1),
  siteType: z.enum([
    'riparian',
    'wetland',
    'woodland',
    'grassland',
    'pollinator',
    'water',
    'soil',
    'other',
  ]),
  targetCondition: z.string(),
  conditionScore: z.number().min(0).max(100).nullable(),
  center: coordinateSchema,
  boundary: z.array(z.tuple([z.number(), z.number()])).min(3),
  indicatorSpecies: z.array(z.string()),
  updatedAt: z.string().datetime(),
  syncState: syncStateSchema,
})

export type EcologicalSite = z.infer<typeof ecologicalSiteSchema>

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
  lorawan: z
    .object({
      applicationId: z.string(),
      devEui: z.string(),
      fPort: z.number().int().min(0).max(255),
      frameCounter: z.number().int().nonnegative(),
      gatewayIds: z.array(z.string()),
      rssi: z.number().nullable(),
      snr: z.number().nullable(),
      spreadingFactor: z.number().int().nullable(),
      frequencyHz: z.number().int().positive().nullable(),
    })
    .nullable()
    .default(null),
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
  syncState: syncStateSchema,
})

export type Observation = z.infer<typeof observationSchema>

export const depthMeasurementSchema = z.object({
  label: z.string().min(1),
  value: z.number().finite().nonnegative(),
  unit: z.enum(['m', 'm2', 'm3']),
  uncertainty: z.number().finite().nonnegative().nullable(),
})

export const cameraCaptureEvidenceSchema = z
  .object({
    captureRequestedAt: z.string().datetime(),
    captureCompletedAt: z.string().datetime(),
    locationObservedAt: z.string().datetime(),
    metadataCreatedAt: z.string().datetime().nullable(),
    sizeBytes: z.number().int().positive().nullable(),
    durationSeconds: z.number().finite().nonnegative().nullable(),
    widthPixels: z.number().int().positive().nullable(),
    heightPixels: z.number().int().positive().nullable(),
    format: z.string().regex(/^[a-z0-9][a-z0-9.+-]{0,31}$/).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Date(value.captureCompletedAt).getTime() <
      new Date(value.captureRequestedAt).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['captureCompletedAt'],
        message: 'Capture completion must not precede its request.',
      })
    }
  })

export const mediaCaptureSchema = z.object({
  id: z.string().uuid(),
  observationId: z.string().uuid().nullable(),
  kind: z.enum([
    'photo',
    'video',
    'depth',
    'depth_confidence',
    'point_cloud',
    'model',
  ]),
  localUri: z.string().min(1),
  previewUri: z.string().nullable(),
  mimeType: z.string().min(1),
  coordinate: coordinateSchema,
  capturedAt: z.string().datetime(),
  deviceModel: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  cameraCaptureEvidence: cameraCaptureEvidenceSchema.nullable().optional(),
  depthMetadata: z
    .object({
      scanId: z.string().uuid(),
      provider: z.enum(['arkit-lidar', 'arcore-depth']),
      role: z.enum(['depth', 'confidence', 'point_cloud', 'model']),
      measurements: z.array(depthMeasurementSchema),
    })
    .nullable()
    .default(null),
  syncState: syncStateSchema,
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
  syncState: syncStateSchema,
})

export type Alert = z.infer<typeof alertSchema>

export const alInsightSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string(),
  sourceReadingIds: z.array(z.string().uuid()),
  fieldId: z.string().uuid().nullable(),
  siteId: z.string().uuid().nullable(),
  severity: z.enum(['info', 'attention']),
  generatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  readOnly: z.literal(true),
})

export type AlInsight = z.infer<typeof alInsightSchema>

export const guardianParticipantStateSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(120),
    mode: z.enum(['child', 'guest', 'supervisor', 'medical']),
    team: z.string().min(1).max(64),
    state: z.enum(['normal', 'caution', 'critical', 'offline']),
    zone: z.string().max(120).nullable(),
    alertState: z.enum(['none', 'warning', 'critical', 'sos']),
    checkIn: z.enum(['current', 'due', 'missed', 'not_required']),
    location: z
      .object({
        coordinate: coordinateSchema.strict(),
        source: z.enum([
          'watch_gnss',
          'ble_estimate',
          'ble_presence',
          'meshtastic',
          'last_known',
        ]),
        confidence: z.enum(['good', 'estimated', 'poor', 'stale']),
        observedAt: z.string().datetime(),
      })
      .strict(),
    device: z
      .object({
        connectivity: z.enum([
          'watch_phone_wifi',
          'watch_phone_cellular',
          'guardian_ble',
          'wifi',
          'meshtastic',
          'offline',
        ]),
        lastContactAt: z.string().datetime(),
        batteryPercent: z.number().min(0).max(100).nullable(),
      })
      .strict(),
    updatedAt: z.string().datetime(),
  })
  .strict()

export type GuardianParticipantState = z.infer<
  typeof guardianParticipantStateSchema
>

export const guardianAlertSchema = z
  .object({
    id: z.string().uuid(),
    participantId: z.string().uuid(),
    ruleId: z.string().min(1).max(120),
    severity: z.enum(['info', 'warning', 'critical']),
    status: z.enum(['active', 'acknowledged', 'resolved']),
    reasonCode: z.string().min(1).max(120),
    title: z.string().min(1).max(160),
    detail: z.string().max(500),
    openedAt: z.string().datetime(),
    acknowledgedAt: z.string().datetime().nullable(),
    resolvedAt: z.string().datetime().nullable(),
    resolutionReason: z.string().max(500).nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((alert, context) => {
    if (alert.status === 'active' && (alert.acknowledgedAt || alert.resolvedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'An active Guardian alert cannot have completion timestamps.',
        path: ['status'],
      })
    }
    if (alert.status === 'acknowledged' && !alert.acknowledgedAt) {
      context.addIssue({
        code: 'custom',
        message: 'An acknowledged Guardian alert requires acknowledgedAt.',
        path: ['acknowledgedAt'],
      })
    }
    if (
      alert.status === 'resolved' &&
      (!alert.resolvedAt || !alert.resolutionReason?.trim())
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A resolved Guardian alert requires time and reason.',
        path: ['resolvedAt'],
      })
    }
  })

export type GuardianAlert = z.infer<typeof guardianAlertSchema>

const guardianBoundaryPointSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
])

export const guardianZoneSchema = z
  .object({
    id: z.string().uuid(),
    propertyId: z.string().uuid(),
    name: z.string().min(1).max(120),
    level: z.enum(['green', 'yellow', 'red']),
    boundary: z.array(guardianBoundaryPointSchema).min(4).max(257),
    enterDwellSeconds: z.number().int().min(0).max(86_400),
    exitDwellSeconds: z.number().int().min(0).max(86_400),
    active: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((zone, context) => {
    const first = zone.boundary[0]
    const last = zone.boundary.at(-1)
    if (!last || first[0] !== last[0] || first[1] !== last[1]) {
      context.addIssue({
        code: 'custom',
        message: 'A Guardian zone boundary must be closed.',
        path: ['boundary'],
      })
    }
    const distinct = new Set(
      zone.boundary
        .slice(0, -1)
        .map(([longitude, latitude]) => `${longitude},${latitude}`),
    )
    if (distinct.size < 3) {
      context.addIssue({
        code: 'custom',
        message: 'A Guardian zone requires three distinct vertices.',
        path: ['boundary'],
      })
    }
  })

export type GuardianZone = z.infer<typeof guardianZoneSchema>

export const tileSourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export const offlineMapRegionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tileSourceId: z.string().regex(tileSourceIdPattern),
  bounds: z.object({
    west: z.number().min(-180).max(180),
    south: z.number().min(-85.051129).max(85.051129),
    east: z.number().min(-180).max(180),
    north: z.number().min(-85.051129).max(85.051129),
  }),
  minZoom: z.number().int().min(0).max(22),
  maxZoom: z.number().int().min(0).max(22),
  tileCount: z.number().int().nonnegative(),
  downloadedTiles: z.number().int().nonnegative(),
  status: z.enum(['planned', 'downloading', 'ready', 'partial', 'failed']),
  updatedAt: z.string().datetime(),
})

export type OfflineMapRegion = z.infer<typeof offlineMapRegionSchema>

export type TakConnectionState =
  | 'not_enrolled'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded'

export const takContactSchema = z.object({
  uid: z.string().min(1).max(256),
  callsign: z.string().min(1).max(128),
  team: z.string().max(64).nullable(),
  coordinate: coordinateSchema,
  staleAt: z.string().datetime({ offset: true }),
})

export type TakContact = z.infer<typeof takContactSchema>

export const depthCapabilitySchema = z
  .object({
    supported: z.boolean(),
    provider: z.enum(['arkit-lidar', 'arcore-depth', 'none']),
    supportsPointCloud: z.boolean(),
    supportsMesh: z.boolean(),
    supportsConfidence: z.boolean(),
    reason: z.string().nullable(),
  })
  .superRefine((capability, context) => {
    if (capability.supported && capability.provider === 'none') {
      context.addIssue({
        code: 'custom',
        message: 'A supported depth capability must name its provider.',
        path: ['provider'],
      })
    }
    if (!capability.supported && capability.provider !== 'none') {
      context.addIssue({
        code: 'custom',
        message: 'An unsupported depth capability must use provider "none".',
        path: ['provider'],
      })
    }
  })

export type DepthCapability = z.infer<typeof depthCapabilitySchema>

export const depthScanResultSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(['arkit-lidar', 'arcore-depth']),
  capturedAt: z.string().datetime(),
  coordinate: coordinateSchema,
  previewUri: z.string().min(1),
  depthUri: z.string().min(1),
  confidenceUri: z.string().min(1).nullable(),
  pointCloudUri: z.string().min(1).nullable(),
  modelUri: z.string().min(1).nullable(),
  measurements: z.array(depthMeasurementSchema),
})

export type DepthScanResult = z.infer<typeof depthScanResultSchema>

export interface DashboardSnapshot {
  properties: Property[]
  seasons: Season[]
  fields: Field[]
  ecologicalSites: EcologicalSite[]
  readings: SensorReading[]
  observations: Observation[]
  alerts: Alert[]
  insights: AlInsight[]
  guardianParticipants: GuardianParticipantState[]
  guardianAlerts: GuardianAlert[]
  guardianZones: GuardianZone[]
  contacts: TakContact[]
}
