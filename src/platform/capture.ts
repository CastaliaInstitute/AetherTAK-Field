import { Capacitor } from '@capacitor/core'
import {
  Camera,
  CameraDirection,
  EncodingType,
  type MediaResult,
} from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import type { Coordinate } from '../domain/models'
import type { MediaCapture } from '../domain/models'

export interface GeotaggedMedia {
  media: MediaResult
  kind: 'photo' | 'video'
  coordinate: Coordinate
  capturedAt: string
  cameraCaptureEvidence: NonNullable<MediaCapture['cameraCaptureEvidence']>
}

interface LocationFix {
  coordinate: Coordinate
  observedAt: string
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null
}

function nonnegativeFinite(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null
}

export function cameraCaptureEvidence(
  media: MediaResult,
  captureRequestedAt: string,
  captureCompletedAt: string,
  locationObservedAt: string,
): NonNullable<MediaCapture['cameraCaptureEvidence']> {
  const resolution = media.metadata?.resolution?.match(
    /^([1-9]\d{0,5})x([1-9]\d{0,5})$/,
  )
  const rawFormat = media.metadata?.format?.trim().toLowerCase()
  const format =
    rawFormat && /^[a-z0-9][a-z0-9.+-]{0,31}$/.test(rawFormat)
      ? rawFormat
      : null

  return {
    captureRequestedAt,
    captureCompletedAt,
    locationObservedAt,
    metadataCreatedAt: validDate(media.metadata?.creationDate),
    sizeBytes: positiveInteger(media.metadata?.size),
    durationSeconds: nonnegativeFinite(media.metadata?.duration),
    widthPixels: resolution ? Number(resolution[1]) : null,
    heightPixels: resolution ? Number(resolution[2]) : null,
    format,
  }
}

export async function currentLocationFix(): Promise<LocationFix> {
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 15_000,
    maximumAge: 5_000,
  })

  return {
    coordinate: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      altitudeMeters: position.coords.altitude ?? null,
      horizontalAccuracyMeters: position.coords.accuracy,
      verticalAccuracyMeters: position.coords.altitudeAccuracy ?? null,
      headingDegrees: position.coords.heading ?? null,
    },
    observedAt: new Date(position.timestamp).toISOString(),
  }
}

export async function currentCoordinate(): Promise<Coordinate> {
  return (await currentLocationFix()).coordinate
}

export async function watchCurrentCoordinate(
  listener: (coordinate: Coordinate) => void,
  onError?: (message: string) => void,
) {
  const id = await Geolocation.watchPosition(
    {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 5_000,
      minimumUpdateInterval: 5_000,
    },
    (position, error) => {
      if (error) {
        onError?.(error.message)
        return
      }
      if (!position) return
      listener({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitudeMeters: position.coords.altitude ?? null,
        horizontalAccuracyMeters: position.coords.accuracy,
        verticalAccuracyMeters: position.coords.altitudeAccuracy ?? null,
        headingDegrees: position.coords.heading ?? null,
      })
    },
  )
  return () => Geolocation.clearWatch({ id })
}

export async function captureGeotaggedPhoto(): Promise<GeotaggedMedia> {
  const captureRequestedAt = new Date().toISOString()
  const [media, location] = await Promise.all([
    Camera.takePhoto({
      quality: 92,
      correctOrientation: true,
      encodingType: EncodingType.JPEG,
      saveToGallery: false,
      cameraDirection: CameraDirection.Rear,
      includeMetadata: true,
    }),
    currentLocationFix(),
  ])
  const captureCompletedAt = new Date().toISOString()

  return {
    media,
    kind: 'photo',
    coordinate: location.coordinate,
    capturedAt: captureCompletedAt,
    cameraCaptureEvidence: cameraCaptureEvidence(
      media,
      captureRequestedAt,
      captureCompletedAt,
      location.observedAt,
    ),
  }
}

export async function captureGeotaggedVideo(): Promise<GeotaggedMedia> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Video recording requires the iOS or Android application.')
  }
  const captureRequestedAt = new Date().toISOString()
  const [media, location] = await Promise.all([
    Camera.recordVideo({
      saveToGallery: false,
      includeMetadata: true,
      isPersistent: true,
    }),
    currentLocationFix(),
  ])
  const captureCompletedAt = new Date().toISOString()

  return {
    media,
    kind: 'video',
    coordinate: location.coordinate,
    capturedAt: captureCompletedAt,
    cameraCaptureEvidence: cameraCaptureEvidence(
      media,
      captureRequestedAt,
      captureCompletedAt,
      location.observedAt,
    ),
  }
}
