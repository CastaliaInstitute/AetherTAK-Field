import { Capacitor } from '@capacitor/core'
import {
  Camera,
  CameraDirection,
  EncodingType,
  type MediaResult,
} from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import type { Coordinate } from '../domain/models'

export interface GeotaggedMedia {
  media: MediaResult
  kind: 'photo' | 'video'
  coordinate: Coordinate
  capturedAt: string
}

export async function currentCoordinate(): Promise<Coordinate> {
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 15_000,
    maximumAge: 5_000,
  })

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    altitudeMeters: position.coords.altitude ?? null,
    horizontalAccuracyMeters: position.coords.accuracy,
    verticalAccuracyMeters: position.coords.altitudeAccuracy ?? null,
    headingDegrees: position.coords.heading ?? null,
  }
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
  const [media, coordinate] = await Promise.all([
    Camera.takePhoto({
      quality: 92,
      correctOrientation: true,
      encodingType: EncodingType.JPEG,
      saveToGallery: false,
      cameraDirection: CameraDirection.Rear,
      includeMetadata: true,
    }),
    currentCoordinate(),
  ])

  return {
    media,
    kind: 'photo',
    coordinate,
    capturedAt: new Date().toISOString(),
  }
}

export async function captureGeotaggedVideo(): Promise<GeotaggedMedia> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Video recording requires the iOS or Android application.')
  }
  const [media, coordinate] = await Promise.all([
    Camera.recordVideo({
      saveToGallery: false,
      includeMetadata: true,
      isPersistent: true,
    }),
    currentCoordinate(),
  ])

  return {
    media,
    kind: 'video',
    coordinate,
    capturedAt: new Date().toISOString(),
  }
}
