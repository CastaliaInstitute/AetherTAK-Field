import { z } from 'zod'
import {
  coordinateSchema,
  sensorReadingSchema,
  type Coordinate,
  type SensorReading,
} from '../domain/models'

const rxInfoSchema = z.object({
  gatewayId: z.string().optional(),
  rssi: z.number().optional(),
  snr: z.number().optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      altitude: z.number().optional(),
    })
    .optional(),
})

const chirpStackUplinkSchema = z.object({
  time: z.string(),
  deviceInfo: z.object({
    applicationId: z.string(),
    applicationName: z.string().optional(),
    deviceName: z.string(),
    devEui: z.string(),
    tags: z.record(z.string(), z.string()).optional(),
  }),
  fCnt: z.number().int().nonnegative(),
  fPort: z.number().int().min(0).max(255),
  object: z.record(z.string(), z.unknown()),
  rxInfo: z.array(rxInfoSchema).default([]),
  txInfo: z
    .object({
      frequency: z.number().optional(),
      modulation: z
        .object({
          lora: z
            .object({
              spreadingFactor: z.number().int().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
})

export interface ChirpStackMeasurementBinding {
  key: string
  measurement: SensorReading['measurement']
  unit: string
  label?: string
  scale?: number
  offset?: number
}

export interface ChirpStackDeviceBinding {
  fieldId: string | null
  siteId: string | null
  label: string
  coordinate: Coordinate
  measurements: ChirpStackMeasurementBinding[]
}

function valueAtPath(
  input: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(key in value)
    ) {
      return undefined
    }
    return (value as Record<string, unknown>)[key]
  }, input)
}

function bestGateway(
  values: z.infer<typeof rxInfoSchema>[],
): z.infer<typeof rxInfoSchema> | undefined {
  return [...values].sort(
    (a, b) => (b.rssi ?? -999) - (a.rssi ?? -999),
  )[0]
}

function gatewayCoordinate(
  gateway: z.infer<typeof rxInfoSchema> | undefined,
  fallback: Coordinate,
): Coordinate {
  if (!gateway?.location) return fallback
  return coordinateSchema.parse({
    latitude: gateway.location.latitude,
    longitude: gateway.location.longitude,
    altitudeMeters: gateway.location.altitude ?? null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
  })
}

export function normalizeChirpStackUplink(
  payload: unknown,
  binding: ChirpStackDeviceBinding,
): SensorReading[] {
  const uplink = chirpStackUplinkSchema.parse(payload)
  const gateway = bestGateway(uplink.rxInfo)
  const coordinate = gatewayCoordinate(gateway, binding.coordinate)
  const gatewayIds = uplink.rxInfo.flatMap((value) =>
    value.gatewayId ? [value.gatewayId] : [],
  )

  return binding.measurements.flatMap((mapping) => {
    const raw = valueAtPath(uplink.object, mapping.key)
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return []

    const value = Number(
      (raw * (mapping.scale ?? 1) + (mapping.offset ?? 0)).toFixed(12),
    )
    return [
      sensorReadingSchema.parse({
        id: crypto.randomUUID(),
        deviceId: uplink.deviceInfo.devEui,
        fieldId: binding.fieldId,
        siteId: binding.siteId,
        label: mapping.label ?? `${binding.label} ${mapping.measurement}`,
        measurement: mapping.measurement,
        value,
        unit: mapping.unit,
        quality: gateway ? 'good' : 'estimated',
        lorawan: {
          applicationId: uplink.deviceInfo.applicationId,
          devEui: uplink.deviceInfo.devEui,
          fPort: uplink.fPort,
          frameCounter: uplink.fCnt,
          gatewayIds,
          rssi: gateway?.rssi ?? null,
          snr: gateway?.snr ?? null,
          spreadingFactor:
            uplink.txInfo?.modulation?.lora?.spreadingFactor ?? null,
          frequencyHz: uplink.txInfo?.frequency ?? null,
        },
        coordinate,
        recordedAt: new Date(uplink.time).toISOString(),
      }),
    ]
  })
}

export async function storeChirpStackUplink(
  payload: unknown,
  binding: ChirpStackDeviceBinding,
) {
  const { db } = await import('../data/database')
  const readings = normalizeChirpStackUplink(payload, binding)
  if (readings.length > 0) await db.readings.bulkPut(readings)
  return readings
}
