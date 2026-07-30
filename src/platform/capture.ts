import {
  Camera,
  CameraResultType,
  CameraSource,
  type Photo,
} from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import type { Coordinate } from '../domain/models'

export interface GeotaggedPhoto {
  photo: Photo
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

export async function captureGeotaggedPhoto(): Promise<GeotaggedPhoto> {
  const [photo, coordinate] = await Promise.all([
    Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 92,
      correctOrientation: true,
      saveToGallery: false,
    }),
    currentCoordinate(),
  ])

  return {
    photo,
    coordinate,
    capturedAt: new Date().toISOString(),
  }
}
