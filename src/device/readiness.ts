import { App, type AppInfo } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Device, type DeviceInfo } from '@capacitor/device'
import { Share } from '@capacitor/share'
import { z } from 'zod'
import { db } from '../data/database'
import type { DepthCapability } from '../domain/models'
import { depthScanner } from '../platform/depth'
import {
  fieldApiTransport,
  takTransport,
  type BackgroundTrackingStatus,
  type NativeFieldResponse,
  type TakStatus,
} from '../platform/tak'

const checkSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['pass', 'attention', 'fail']),
  detail: z.string().min(1),
})

const databaseMetricsSchema = z.object({
  records: z.object({
    properties: z.number().int().nonnegative(),
    seasons: z.number().int().nonnegative(),
    fields: z.number().int().nonnegative(),
    ecologicalSites: z.number().int().nonnegative(),
    readings: z.number().int().nonnegative(),
    observations: z.number().int().nonnegative(),
    alerts: z.number().int().nonnegative(),
    insights: z.number().int().nonnegative(),
  }),
  fieldQueue: z.object({
    pending: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    attemptedFailures: z.number().int().nonnegative(),
  }),
  takQueue: z.object({
    pending: z.number().int().nonnegative(),
    attemptedFailures: z.number().int().nonnegative(),
  }),
  offlineMaps: z.object({
    total: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    partialOrFailed: z.number().int().nonnegative(),
    downloadedTiles: z.number().int().nonnegative(),
  }),
  media: z.object({
    total: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    checksumEligible: z.number().int().nonnegative(),
    checksummed: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number().int().nonnegative()),
  }),
  synchronization: z.object({
    cursor: z.number().int().nonnegative(),
    lastSyncAt: z.string().datetime().nullable(),
  }),
})

export const deviceReadinessReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  overall: z.enum(['pass', 'attention', 'fail']),
  app: z.object({
    name: z.string(),
    id: z.string(),
    version: z.string(),
    build: z.string(),
    sourceRevision: z.string(),
  }),
  device: z.object({
    platform: z.enum(['ios', 'android', 'web']),
    operatingSystem: z.string(),
    osVersion: z.string(),
    model: z.string(),
    manufacturer: z.string(),
    isVirtual: z.boolean(),
    webViewVersion: z.string(),
  }),
  runtime: z.object({
    native: z.boolean(),
    online: z.boolean(),
    storageEstimateBytes: z.number().nonnegative().nullable(),
    storageQuotaBytes: z.number().nonnegative().nullable(),
    contactCount: z.number().int().nonnegative(),
  }),
  tak: z.object({
    state: z.string(),
    profile: z
      .object({
        name: z.string(),
        callsign: z.string(),
        team: z.string(),
      })
      .nullable(),
    lastConnectedAt: z.string().datetime().nullable(),
  }),
  backgroundTracking: z.object({
    supported: z.boolean(),
    enabled: z.boolean(),
    detail: z.string(),
  }),
  depth: z.object({
    supported: z.boolean(),
    provider: z.string(),
    supportsPointCloud: z.boolean(),
    supportsMesh: z.boolean(),
    supportsConfidence: z.boolean(),
    reason: z.string().nullable(),
  }),
  database: databaseMetricsSchema,
  checks: z.array(checkSchema),
  privacy: z.object({
    excludes: z.array(z.string()),
  }),
})

export type DatabaseMetrics = z.infer<typeof databaseMetricsSchema>
export type DeviceReadinessReport = z.infer<
  typeof deviceReadinessReportSchema
>

interface ReadinessSnapshot {
  generatedAt: string
  sourceRevision: string
  native: boolean
  online: boolean
  app: AppInfo
  device: DeviceInfo
  storage: { usage?: number; quota?: number }
  contactCount: number
  tak: TakStatus
  fieldApi: FieldApiProbe
  backgroundTracking: BackgroundTrackingStatus
  depth: DepthCapability
  database: DatabaseMetrics
}

interface ReadinessServices {
  now: () => Date
  sourceRevision: () => string
  isNative: () => boolean
  isOnline: () => boolean
  appInfo: () => Promise<AppInfo>
  deviceInfo: () => Promise<DeviceInfo>
  storageEstimate: () => Promise<{ usage?: number; quota?: number }>
  takStatus: () => Promise<TakStatus>
  fieldApiHealth: () => Promise<NativeFieldResponse>
  backgroundTracking: () => Promise<BackgroundTrackingStatus>
  depthCapability: () => Promise<DepthCapability>
  databaseMetrics: () => Promise<DatabaseMetrics>
}

export interface FieldApiProbe {
  state: 'healthy' | 'offline' | 'unavailable' | 'not_native'
  httpStatus: number | null
}

const fallbackAppInfo: AppInfo = {
  name: 'AetherTAK Field',
  id: 'org.castaliainstitute.aethertak.field',
  version: 'web-preview',
  build: 'development',
}

async function collectDatabaseMetrics(): Promise<DatabaseMetrics> {
  const [
    properties,
    seasons,
    fields,
    ecologicalSites,
    readings,
    observations,
    alerts,
    insights,
    fieldQueue,
    takQueue,
    offlineMaps,
    media,
    sync,
  ] = await Promise.all([
    db.properties.count(),
    db.seasons.count(),
    db.fields.count(),
    db.ecologicalSites.count(),
    db.readings.count(),
    db.observations.count(),
    db.alerts.count(),
    db.insights.count(),
    db.outbox.toArray(),
    db.takOutbox.toArray(),
    db.offlineMapRegions.toArray(),
    db.media.toArray(),
    db.syncControl.get('field'),
  ])
  const byKind = media.reduce<Record<string, number>>((counts, artifact) => {
    counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1
    return counts
  }, {})
  const checksumEligible = media
  return databaseMetricsSchema.parse({
    records: {
      properties,
      seasons,
      fields,
      ecologicalSites,
      readings,
      observations,
      alerts,
      insights,
    },
    fieldQueue: {
      pending: fieldQueue.length,
      conflicts: fieldQueue.filter((item) => item.conflict !== null).length,
      attemptedFailures: fieldQueue.filter((item) => item.attempts > 0).length,
    },
    takQueue: {
      pending: takQueue.length,
      attemptedFailures: takQueue.filter((item) => item.attempts > 0).length,
    },
    offlineMaps: {
      total: offlineMaps.length,
      ready: offlineMaps.filter((region) => region.status === 'ready').length,
      partialOrFailed: offlineMaps.filter(
        (region) => region.status === 'partial' || region.status === 'failed',
      ).length,
      downloadedTiles: offlineMaps.reduce(
        (sum, region) => sum + region.downloadedTiles,
        0,
      ),
    },
    media: {
      total: media.length,
      queued: media.filter((artifact) => artifact.syncState === 'queued').length,
      checksumEligible: checksumEligible.length,
      checksummed: checksumEligible.filter((artifact) => artifact.sha256).length,
      byKind,
    },
    synchronization: {
      cursor: sync?.cursor ?? 0,
      lastSyncAt: sync?.lastSyncAt ?? null,
    },
  })
}

const defaultServices: ReadinessServices = {
  now: () => new Date(),
  sourceRevision: () =>
    import.meta.env.VITE_AETHER_SOURCE_REVISION ?? 'development',
  isNative: () => Capacitor.isNativePlatform(),
  isOnline: () => navigator.onLine,
  appInfo: async () => {
    try {
      return await App.getInfo()
    } catch {
      return fallbackAppInfo
    }
  },
  deviceInfo: () => Device.getInfo(),
  storageEstimate: async () => {
    try {
      return await navigator.storage?.estimate() ?? {}
    } catch {
      return {}
    }
  },
  takStatus: () => takTransport.status(),
  fieldApiHealth: () => fieldApiTransport.health(),
  backgroundTracking: () => takTransport.backgroundTrackingStatus(),
  depthCapability: () => depthScanner.capability(),
  databaseMetrics: collectDatabaseMetrics,
}

export async function probeFieldApi(
  native: boolean,
  online: boolean,
  health: () => Promise<NativeFieldResponse>,
): Promise<FieldApiProbe> {
  if (!native) return { state: 'not_native', httpStatus: null }
  if (!online) return { state: 'offline', httpStatus: null }
  try {
    const response = await health()
    return {
      state:
        response.status === 200 && response.body.status === 'ok'
          ? 'healthy'
          : 'unavailable',
      httpStatus: response.status,
    }
  } catch {
    return { state: 'unavailable', httpStatus: null }
  }
}

function queueCheck(
  id: string,
  label: string,
  pending: number,
  attemptedFailures: number,
  conflicts = 0,
) {
  if (conflicts > 0) {
    return {
      id,
      label,
      status: 'fail' as const,
      detail: `${conflicts} unresolved conflict${conflicts === 1 ? '' : 's'}.`,
    }
  }
  if (attemptedFailures > 0) {
    return {
      id,
      label,
      status: 'attention' as const,
      detail: `${attemptedFailures} queued item${attemptedFailures === 1 ? '' : 's'} have failed at least once.`,
    }
  }
  return {
    id,
    label,
    status: pending > 0 ? 'attention' as const : 'pass' as const,
    detail: pending > 0
      ? `${pending} item${pending === 1 ? '' : 's'} waiting to synchronize.`
      : 'Queue is clear.',
  }
}

export function buildDeviceReadinessReport(
  snapshot: ReadinessSnapshot,
): DeviceReadinessReport {
  const { database } = snapshot
  const checks: DeviceReadinessReport['checks'] = [
    {
      id: 'native-runtime',
      label: 'Native runtime',
      status: snapshot.native ? 'pass' : 'fail',
      detail: snapshot.native
        ? `Running as the ${snapshot.device.platform} application.`
        : 'This report was generated in the browser preview.',
    },
    {
      id: 'physical-device',
      label: 'Physical device',
      status: snapshot.native && !snapshot.device.isVirtual ? 'pass' : 'fail',
      detail: snapshot.device.isVirtual
        ? 'Simulator or emulator detected.'
        : snapshot.native
          ? 'Physical device reported by the native runtime.'
          : 'Physical-device evidence requires the iOS or Android application.',
    },
    {
      id: 'tak-enrollment',
      label: 'TAK certificate enrollment',
      status: snapshot.tak.profile ? 'pass' : 'fail',
      detail: snapshot.tak.profile
        ? `Enrolled for ${snapshot.tak.profile.name}.`
        : 'No active certificate profile.',
    },
    {
      id: 'tak-connection',
      label: 'TAK connection',
      status: snapshot.tak.state === 'connected' ? 'pass' : 'attention',
      detail: snapshot.tak.state === 'connected'
        ? `Connected${snapshot.tak.lastConnectedAt ? ` at ${snapshot.tak.lastConnectedAt}` : ''}.`
        : `Current state: ${snapshot.tak.state}.`,
    },
    {
      id: 'field-api-health',
      label: 'Aether Field API',
      status:
        snapshot.fieldApi.state === 'healthy'
          ? 'pass'
          : snapshot.fieldApi.state === 'offline'
            ? 'attention'
            : 'fail',
      detail:
        snapshot.fieldApi.state === 'healthy'
          ? 'Certificate-authenticated health check passed.'
          : snapshot.fieldApi.state === 'offline'
            ? 'Health check deferred because the device is offline.'
            : snapshot.fieldApi.state === 'not_native'
              ? 'Authenticated field synchronization requires the iOS or Android application.'
              : snapshot.fieldApi.httpStatus === null
                ? 'The certificate-authenticated field service could not be reached.'
                : `The certificate-authenticated field service returned HTTP ${snapshot.fieldApi.httpStatus}.`,
    },
    {
      id: 'background-tracking',
      label: 'Background team tracking',
      status: snapshot.backgroundTracking.supported ? 'pass' : 'fail',
      detail: snapshot.backgroundTracking.detail,
    },
    {
      id: 'depth-capability',
      label: 'Depth capture',
      status: snapshot.depth.supported ? 'pass' : 'attention',
      detail: snapshot.depth.supported
        ? `${snapshot.depth.provider} available.`
        : snapshot.depth.reason ?? 'Depth hardware is unavailable.',
    },
    queueCheck(
      'field-sync',
      'Field synchronization',
      database.fieldQueue.pending,
      database.fieldQueue.attemptedFailures,
      database.fieldQueue.conflicts,
    ),
    queueCheck(
      'tak-outbox',
      'TAK event delivery',
      database.takQueue.pending,
      database.takQueue.attemptedFailures,
    ),
    {
      id: 'offline-maps',
      label: 'Offline maps',
      status: database.offlineMaps.ready > 0 ? 'pass' : 'attention',
      detail: database.offlineMaps.ready > 0
        ? `${database.offlineMaps.ready} ready region${database.offlineMaps.ready === 1 ? '' : 's'} with ${database.offlineMaps.downloadedTiles} cached tiles.`
        : 'No ready offline map region.',
    },
    {
      id: 'media-integrity',
      label: 'Media integrity',
      status:
        database.media.checksumEligible > 0 &&
        database.media.checksummed === database.media.checksumEligible
          ? 'pass'
          : 'attention',
      detail: database.media.checksumEligible === 0
        ? 'No media or depth evidence has been captured.'
        : `${database.media.checksummed} of ${database.media.checksumEligible} evidence artifacts have SHA-256 metadata.`,
    },
    {
      id: 'network',
      label: 'Network state',
      status: snapshot.online ? 'pass' : 'attention',
      detail: snapshot.online
        ? 'Online when the report was generated.'
        : 'Offline when the report was generated.',
    },
  ]
  const overall = checks.some((check) => check.status === 'fail')
    ? 'fail'
    : checks.some((check) => check.status === 'attention')
      ? 'attention'
      : 'pass'

  return deviceReadinessReportSchema.parse({
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    overall,
    app: {
      ...snapshot.app,
      sourceRevision: snapshot.sourceRevision,
    },
    device: {
      platform: snapshot.device.platform,
      operatingSystem: snapshot.device.operatingSystem,
      osVersion: snapshot.device.osVersion,
      model: snapshot.device.model,
      manufacturer: snapshot.device.manufacturer,
      isVirtual: snapshot.device.isVirtual,
      webViewVersion: snapshot.device.webViewVersion,
    },
    runtime: {
      native: snapshot.native,
      online: snapshot.online,
      storageEstimateBytes: snapshot.storage.usage ?? null,
      storageQuotaBytes: snapshot.storage.quota ?? null,
      contactCount: snapshot.contactCount,
    },
    tak: {
      state: snapshot.tak.state,
      profile: snapshot.tak.profile
          ? {
            name: snapshot.tak.profile.name,
            callsign: snapshot.tak.profile.callsign,
            team: snapshot.tak.profile.team,
          }
        : null,
      lastConnectedAt: snapshot.tak.lastConnectedAt,
    },
    backgroundTracking: snapshot.backgroundTracking,
    depth: snapshot.depth,
    database,
    checks,
    privacy: {
      excludes: [
        'certificate and private-key material',
        'enrollment package passwords',
        'server addresses and profile identifiers',
        'device identifiers and personal device names',
        'coordinates and location history',
        'chat and TAK event contents',
        'observation notes and media contents',
      ],
    },
  })
}

export async function collectDeviceReadiness(
  contactCount: number,
  overrides: Partial<ReadinessServices> = {},
) {
  const services = { ...defaultServices, ...overrides }
  const native = services.isNative()
  const online = services.isOnline()
  const [
    app,
    device,
    storage,
    tak,
    fieldApi,
    backgroundTracking,
    depth,
    database,
  ] = await Promise.all([
    services.appInfo(),
    services.deviceInfo(),
    services.storageEstimate(),
    services.takStatus(),
    probeFieldApi(native, online, services.fieldApiHealth),
    services.backgroundTracking(),
    services.depthCapability(),
    services.databaseMetrics(),
  ])
  return buildDeviceReadinessReport({
    generatedAt: services.now().toISOString(),
    sourceRevision: services.sourceRevision(),
    native,
    online,
    app,
    device,
    storage,
    contactCount,
    tak,
    fieldApi,
    backgroundTracking,
    depth,
    database,
  })
}

export function serializeDeviceReadiness(report: DeviceReadinessReport) {
  return JSON.stringify(deviceReadinessReportSchema.parse(report), null, 2)
}

export async function shareDeviceReadiness(
  report: DeviceReadinessReport,
): Promise<'shared' | 'downloaded'> {
  const text = serializeDeviceReadiness(report)
  if ((await Share.canShare()).value) {
    await Share.share({
      title: `AetherTAK Field ${report.app.version} readiness`,
      text,
      dialogTitle: 'Share device readiness evidence',
    })
    return 'shared'
  }

  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download =
    `aethertak-field-readiness-${report.generatedAt.replaceAll(':', '-')}.json`
  link.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
