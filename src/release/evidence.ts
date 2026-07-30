import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { Preferences } from '@capacitor/preferences'
import { Share } from '@capacitor/share'
import { z } from 'zod'

export const physicalReleaseChecks = [
  [
    'enrollment_import',
    'Certificate enrollment',
    'Import a fresh AetherTAK package, connect, and confirm the expected callsign and team.',
  ],
  [
    'enrollment_replacement',
    'Certificate renewal',
    'Replace the active enrollment and confirm the new identity connects while the retired identity is removed.',
  ],
  [
    'offline_relaunch',
    'Offline capture and relaunch',
    'Create field records and evidence offline, terminate the app, relaunch, and confirm nothing is lost.',
  ],
  [
    'ordered_sync',
    'Ordered reconnect synchronization',
    'Make sequential offline edits, reconnect, and confirm server and device converge in order.',
  ],
  [
    'conflict_resolution',
    'Conflict recovery',
    'Exercise a real edit conflict and confirm each explicit resolution path preserves the intended record.',
  ],
  [
    'photo_geotag_integrity',
    'Geotagged photo',
    'Capture a structured photo offline and verify location metadata, preview, digest, and synchronized artifact.',
  ],
  [
    'video_geotag_integrity',
    'Geotagged video',
    'Capture a structured video offline and verify location metadata, playback, digest, and synchronized artifact.',
  ],
  [
    'media_roundtrip',
    'Media round trip',
    'Remove a local synchronized artifact, hydrate it again, and verify its type, size, and SHA-256 digest.',
  ],
  [
    'depth_known_dimension',
    'Known-dimension depth accuracy',
    'Scan a controlled target and record its known distance, measured distance, and accepted tolerance.',
  ],
  [
    'depth_artifacts',
    'Depth artifact export',
    'Verify preview, metric depth, confidence when supported, point cloud, measurements, and supported model output.',
  ],
  [
    'depth_fallback',
    'Unsupported-depth fallback',
    'On hardware without supported depth, confirm capability detection and the non-crashing fallback workflow.',
  ],
  [
    'background_lock',
    'Screen-lock team tracking',
    'Lock the screen and verify throttled PLI plus the required iOS indicator or Android foreground notification.',
  ],
  [
    'permission_revocation',
    'Permission revocation',
    'Revoke location/camera permission during the workflow; on Android also revoke notification visibility during background PLI. Confirm a safe, recoverable failure, stopped hidden sharing, and no stale indicator.',
  ],
  [
    'airplane_mode',
    'Airplane-mode recovery',
    'Enter airplane mode with queued work, relaunch, restore connectivity, and verify automatic recovery.',
  ],
  [
    'low_storage',
    'Low-storage behavior',
    'Exercise capture or map download near the platform storage limit and confirm bounded, recoverable failure.',
  ],
] as const

export type PhysicalReleaseCheck = (typeof physicalReleaseChecks)[number][0]
export type PhysicalReleaseStatus =
  | 'pending'
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'not_applicable'

const checkIds = physicalReleaseChecks.map(([id]) => id) as [
  PhysicalReleaseCheck,
  ...PhysicalReleaseCheck[],
]

const depthMeasurementSchema = z.object({
  knownDistanceMeters: z.number().positive().max(10_000),
  measuredDistanceMeters: z.number().positive().max(10_000),
  tolerancePercent: z.number().positive().max(100),
  absoluteErrorPercent: z.number().nonnegative(),
})

const physicalResultSchema = z.object({
  check: z.enum(checkIds),
  status: z.enum([
    'pending',
    'pass',
    'fail',
    'blocked',
    'not_applicable',
  ]),
  testedAt: z.string().datetime().nullable(),
  evidenceReference: z.string().trim().max(240),
  notes: z.string().trim().max(500),
  depthMeasurement: depthMeasurementSchema.nullable(),
})

export const physicalReleaseSessionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  release: z.object({
    appVersion: z.string().trim().min(1).max(80),
    build: z.string().trim().min(1).max(80),
    sourceRevision: z.string().trim().min(1).max(80),
  }),
  device: z.object({
    platform: z.enum(['ios', 'android', 'web']),
    model: z.string().trim().min(1).max(120),
    operatingSystem: z.string().trim().min(1).max(120),
    osVersion: z.string().trim().min(1).max(120),
    isVirtual: z.boolean(),
  }),
  evidenceSetReference: z.string().trim().min(1).max(240),
  results: z.array(physicalResultSchema).length(physicalReleaseChecks.length),
  privacy: z.object({
    excludesCredentials: z.literal(true),
    excludesServerAddress: z.literal(true),
    excludesCoordinates: z.literal(true),
    excludesRecordAndMessageContent: z.literal(true),
    excludesMediaAndLogs: z.literal(true),
    excludesPersonalTesterIdentity: z.literal(true),
  }),
})

export type PhysicalReleaseSession = z.infer<
  typeof physicalReleaseSessionSchema
>
export type PhysicalReleaseResult = z.infer<typeof physicalResultSchema>
export type PhysicalReleaseVerdict =
  | 'incomplete'
  | 'pass'
  | 'attention'
  | 'fail'

const preferenceKey = 'aethertak.physical-release-session.v1'
const sourceRevision =
  import.meta.env.VITE_AETHER_SOURCE_REVISION ?? 'development'

function initialResults(): PhysicalReleaseResult[] {
  return physicalReleaseChecks.map(([check]) => ({
    check,
    status: 'pending',
    testedAt: null,
    evidenceReference: '',
    notes: '',
    depthMeasurement: null,
  }))
}

function resultIsComplete(result: PhysicalReleaseResult) {
  if (result.status === 'pending') return false
  if (result.status === 'not_applicable') return result.notes.length > 0
  return result.evidenceReference.length > 0
}

function completionTime(results: PhysicalReleaseResult[], now: string) {
  return results.every(resultIsComplete) ? now : null
}

export function physicalReleaseVerdict(
  session: PhysicalReleaseSession,
): PhysicalReleaseVerdict {
  if (!session.results.every(resultIsComplete)) return 'incomplete'
  if (
    session.device.isVirtual ||
    session.device.platform === 'web' ||
    session.results.some(
      (result) => result.status === 'fail' || result.status === 'blocked',
    )
  ) return 'fail'
  if (
    session.results.some((result) => result.status === 'not_applicable')
  ) return 'attention'
  return 'pass'
}

export async function createPhysicalReleaseSession(
  evidenceSetReference: string,
): Promise<PhysicalReleaseSession> {
  const [app, device] = await Promise.all([
    Capacitor.isNativePlatform()
      ? App.getInfo()
      : Promise.resolve({
          name: 'AetherTAK Field',
          id: 'org.castaliainstitute.aethertak.field',
          version: 'development',
          build: 'browser',
        }),
    Device.getInfo(),
  ])
  const now = new Date().toISOString()
  return physicalReleaseSessionSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    release: {
      appVersion: app.version,
      build: app.build,
      sourceRevision,
    },
    device: {
      platform: device.platform,
      model: device.model,
      operatingSystem: device.operatingSystem,
      osVersion: device.osVersion,
      isVirtual: device.isVirtual,
    },
    evidenceSetReference,
    results: initialResults(),
    privacy: {
      excludesCredentials: true,
      excludesServerAddress: true,
      excludesCoordinates: true,
      excludesRecordAndMessageContent: true,
      excludesMediaAndLogs: true,
      excludesPersonalTesterIdentity: true,
    },
  })
}

export function updatePhysicalReleaseResult(
  session: PhysicalReleaseSession,
  check: PhysicalReleaseCheck,
  update: Pick<
    PhysicalReleaseResult,
    'status' | 'evidenceReference' | 'notes'
  >,
): PhysicalReleaseSession {
  const now = new Date().toISOString()
  const results = session.results.map((result) =>
    result.check === check
      ? {
          ...result,
          ...update,
          testedAt: update.status === 'pending' ? null : now,
          depthMeasurement: result.depthMeasurement,
        }
      : result,
  )
  return physicalReleaseSessionSchema.parse({
    ...session,
    results,
    updatedAt: now,
    completedAt: completionTime(results, now),
  })
}

export function recordDepthAccuracy(
  session: PhysicalReleaseSession,
  measurement: Omit<
    z.infer<typeof depthMeasurementSchema>,
    'absoluteErrorPercent'
  >,
  evidenceReference: string,
  notes: string,
): PhysicalReleaseSession {
  const known = measurement.knownDistanceMeters
  const absoluteErrorPercent =
    Math.abs(measurement.measuredDistanceMeters - known) / known * 100
  const depthMeasurement = depthMeasurementSchema.parse({
    ...measurement,
    absoluteErrorPercent,
  })
  const now = new Date().toISOString()
  const results = session.results.map((result) =>
    result.check === 'depth_known_dimension'
      ? {
          ...result,
          status:
            absoluteErrorPercent <= measurement.tolerancePercent
              ? 'pass' as const
              : 'fail' as const,
          testedAt: now,
          evidenceReference,
          notes,
          depthMeasurement,
        }
      : result,
  )
  return physicalReleaseSessionSchema.parse({
    ...session,
    results,
    updatedAt: now,
    completedAt: completionTime(results, now),
  })
}

export async function savePhysicalReleaseSession(
  session: PhysicalReleaseSession,
) {
  await Preferences.set({
    key: preferenceKey,
    value: JSON.stringify(physicalReleaseSessionSchema.parse(session)),
  })
}

export async function loadPhysicalReleaseSession() {
  const { value } = await Preferences.get({ key: preferenceKey })
  if (!value) return null
  return physicalReleaseSessionSchema.parse(JSON.parse(value))
}

export async function clearPhysicalReleaseSession() {
  await Preferences.remove({ key: preferenceKey })
}

export async function sharePhysicalReleaseSession(
  session: PhysicalReleaseSession,
) {
  const validated = physicalReleaseSessionSchema.parse(session)
  const text = JSON.stringify(validated, null, 2)
  if (Capacitor.isNativePlatform()) {
    await Share.share({
      title: 'AetherTAK Field physical release evidence',
      text,
      dialogTitle: 'Share controlled release evidence',
    })
    return
  }
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `aethertak-physical-release-${validated.id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
