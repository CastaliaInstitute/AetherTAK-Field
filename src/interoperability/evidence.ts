import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { Preferences } from '@capacitor/preferences'
import { Share } from '@capacitor/share'
import { z } from 'zod'

export const interoperabilityCapabilities = [
  ['pli', 'PLI and contact lifecycle'],
  ['background_pli', 'Background PLI with screen locked'],
  ['geochat', 'Direct GeoChat'],
  ['marker', 'Marker'],
  ['route', 'Route'],
  ['open_shape', 'Open shape'],
  ['closed_shape', 'Closed shape'],
  ['emergency_start', 'Emergency initiation'],
  ['emergency_cancel', 'Emergency cancellation'],
  ['mission_package', 'Mission-package attachment'],
  ['reconnect', 'Reconnect after network loss'],
  ['stale_removal', 'Stale-item removal'],
] as const

export type InteroperabilityCapability =
  (typeof interoperabilityCapabilities)[number][0]
export type InteroperabilityDirection = 'field_to_peer' | 'peer_to_field'
export type InteroperabilityResultStatus =
  | 'pending'
  | 'pass'
  | 'fail'
  | 'blocked'

const resultSchema = z.object({
  capability: z.enum(
    interoperabilityCapabilities.map(([id]) => id) as [
      InteroperabilityCapability,
      ...InteroperabilityCapability[],
    ],
  ),
  direction: z.enum(['field_to_peer', 'peer_to_field']),
  status: z.enum(['pending', 'pass', 'fail', 'blocked']),
  testedAt: z.string().datetime().nullable(),
  evidenceReference: z.string().trim().max(240),
  notes: z.string().trim().max(500),
})

export const interoperabilitySessionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  peer: z.object({
    client: z.enum(['iTAK', 'ATAK']),
    version: z.string().trim().min(1).max(80),
    deviceModel: z.string().trim().min(1).max(120),
    osVersion: z.string().trim().min(1).max(120),
  }),
  field: z.object({
    appVersion: z.string().trim().min(1).max(80),
    build: z.string().trim().min(1).max(80),
    sourceRevision: z.string().trim().min(1).max(80),
    platform: z.enum(['ios', 'android', 'web']).optional(),
    deviceModel: z.string().trim().min(1).max(120),
    osVersion: z.string().trim().min(1).max(120),
  }),
  serverVersion: z.string().trim().min(1).max(120),
  senderCallsign: z.string().trim().min(1).max(80),
  recipientCallsign: z.string().trim().min(1).max(80),
  serverLogInterval: z.object({
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
    reference: z.string().trim().max(240),
  }),
  results: z.array(resultSchema).length(
    interoperabilityCapabilities.length * 2,
  ),
  privacy: z.object({
    excludesServerAddress: z.literal(true),
    excludesCoordinates: z.literal(true),
    excludesMessageContent: z.literal(true),
    excludesBinaryEvidence: z.literal(true),
  }),
})

export type InteroperabilitySession = z.infer<
  typeof interoperabilitySessionSchema
>
export type InteroperabilityResult = z.infer<typeof resultSchema>

export interface NewInteroperabilitySession {
  peerClient: 'iTAK' | 'ATAK'
  peerVersion: string
  peerDeviceModel: string
  peerOsVersion: string
  serverVersion: string
  senderCallsign: string
  recipientCallsign: string
}
const preferenceKey = 'aethertak.interoperability-session.v1'
const sourceRevision =
  import.meta.env.VITE_AETHER_SOURCE_REVISION ?? 'development'

function allResults(): InteroperabilityResult[] {
  return interoperabilityCapabilities.flatMap(([capability]) =>
    (['field_to_peer', 'peer_to_field'] as const).map((direction) => ({
      capability,
      direction,
      status: 'pending' as const,
      testedAt: null,
      evidenceReference: '',
      notes: '',
    })),
  )
}

export async function createInteroperabilitySession(
  input: NewInteroperabilitySession,
): Promise<InteroperabilitySession> {
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
  return interoperabilitySessionSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    peer: {
      client: input.peerClient,
      version: input.peerVersion,
      deviceModel: input.peerDeviceModel,
      osVersion: input.peerOsVersion,
    },
    field: {
      appVersion: app.version,
      build: app.build,
      sourceRevision,
      platform: device.platform,
      deviceModel: device.model,
      osVersion: `${device.operatingSystem} ${device.osVersion}`,
    },
    serverVersion: input.serverVersion,
    senderCallsign: input.senderCallsign,
    recipientCallsign: input.recipientCallsign,
    serverLogInterval: {
      startsAt: null,
      endsAt: null,
      reference: '',
    },
    results: allResults(),
    privacy: {
      excludesServerAddress: true,
      excludesCoordinates: true,
      excludesMessageContent: true,
      excludesBinaryEvidence: true,
    },
  })
}

function completionTime(results: InteroperabilityResult[], now: string) {
  return results.every((result) => result.status !== 'pending') ? now : null
}

export function updateInteroperabilityResult(
  session: InteroperabilitySession,
  capability: InteroperabilityCapability,
  direction: InteroperabilityDirection,
  update: Pick<
    InteroperabilityResult,
    'status' | 'evidenceReference' | 'notes'
  >,
): InteroperabilitySession {
  const now = new Date().toISOString()
  const results = session.results.map((result) =>
    result.capability === capability && result.direction === direction
      ? {
          ...result,
          ...update,
          testedAt: update.status === 'pending' ? null : now,
        }
      : result,
  )
  return interoperabilitySessionSchema.parse({
    ...session,
    results,
    updatedAt: now,
    completedAt: completionTime(results, now),
  })
}

export function updateInteroperabilityLog(
  session: InteroperabilitySession,
  update: InteroperabilitySession['serverLogInterval'],
): InteroperabilitySession {
  const now = new Date().toISOString()
  return interoperabilitySessionSchema.parse({
    ...session,
    serverLogInterval: update,
    updatedAt: now,
    completedAt: completionTime(session.results, now),
  })
}

export async function saveInteroperabilitySession(
  session: InteroperabilitySession,
) {
  const value = JSON.stringify(interoperabilitySessionSchema.parse(session))
  await Preferences.set({ key: preferenceKey, value })
}

export async function loadInteroperabilitySession() {
  const { value } = await Preferences.get({ key: preferenceKey })
  if (!value) return null
  return interoperabilitySessionSchema.parse(JSON.parse(value))
}

export async function clearInteroperabilitySession() {
  await Preferences.remove({ key: preferenceKey })
}

export async function shareInteroperabilitySession(
  session: InteroperabilitySession,
) {
  const validated = interoperabilitySessionSchema.parse(session)
  const text = JSON.stringify(validated, null, 2)
  if (Capacitor.isNativePlatform()) {
    await Share.share({
      title: `${validated.peer.client} interoperability evidence`,
      text,
      dialogTitle: 'Share controlled test evidence',
    })
    return
  }
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `aethertak-${validated.peer.client.toLowerCase()}-interop-${validated.id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
