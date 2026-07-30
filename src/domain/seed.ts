import type {
  Alert,
  AlInsight,
  DashboardSnapshot,
  EcologicalSite,
  Field,
  Property,
  Season,
  SensorReading,
  TakContact,
} from './models'

const now = new Date()
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString()

export const demoProperties: Property[] = [
  {
    id: 'c74e7ae2-e8cc-4f9a-82d2-df837b042ded',
    name: 'Aether Urban Farm',
    description: 'Production beds and creek restoration monitoring area.',
    center: {
      latitude: 39.7406,
      longitude: -104.993,
      altitudeMeters: 1608,
      horizontalAccuracyMeters: null,
      verticalAccuracyMeters: null,
      headingDegrees: null,
    },
    boundary: [
      [-104.9973, 39.743],
      [-104.9882, 39.743],
      [-104.9882, 39.7383],
      [-104.9973, 39.7383],
      [-104.9973, 39.743],
    ],
    timezone: 'America/Denver',
    updatedAt: minutesAgo(20),
    syncState: 'synced',
  },
]

export const demoSeasons: Season[] = [
  {
    id: '46882450-d534-4544-ad60-5e9adcf66a99',
    propertyId: demoProperties[0].id,
    name: 'Summer 2026',
    startsOn: '2026-05-15',
    endsOn: '2026-10-15',
    status: 'active',
    notes: 'Market production and annual ecological monitoring.',
    updatedAt: minutesAgo(15),
    syncState: 'synced',
  },
]

export const demoFields: Field[] = [
  {
    id: '28f77310-f12d-4fd5-8097-3387e83fd49f',
    propertyId: demoProperties[0].id,
    seasonId: demoSeasons[0].id,
    name: 'North Market Beds',
    crop: 'Leaf lettuce',
    cropIcon: '🥬',
    variety: 'Green Star',
    seasonLabel: 'Summer 2026',
    status: 'growing',
    healthScore: 92,
    boundary: [
      [-104.9968, 39.7425],
      [-104.9928, 39.7425],
      [-104.9928, 39.7395],
      [-104.9968, 39.7395],
      [-104.9968, 39.7425],
    ],
    updatedAt: minutesAgo(4),
  },
  {
    id: 'd590ba20-76fa-46a0-a880-e1b3eb56569c',
    propertyId: demoProperties[0].id,
    seasonId: demoSeasons[0].id,
    name: 'Creek Restoration',
    crop: 'Riparian habitat',
    cropIcon: '🌿',
    variety: null,
    seasonLabel: '2026 monitoring',
    status: 'attention',
    healthScore: 68,
    boundary: [
      [-104.9917, 39.7418],
      [-104.9887, 39.7413],
      [-104.9892, 39.7388],
      [-104.9922, 39.7392],
      [-104.9917, 39.7418],
    ],
    updatedAt: minutesAgo(12),
  },
]

export const demoEcologicalSites: EcologicalSite[] = [
  {
    id: '2572972e-5124-447c-bd70-3b601cbfa641',
    propertyId: demoProperties[0].id,
    name: 'Cherry Creek Bank',
    siteType: 'riparian',
    targetCondition: 'Continuous native cover and stable stream bank.',
    conditionScore: 68,
    center: {
      latitude: 39.7401,
      longitude: -104.9902,
      altitudeMeters: 1606,
      horizontalAccuracyMeters: 4,
      verticalAccuracyMeters: 6,
      headingDegrees: null,
    },
    boundary: demoFields[1].boundary,
    indicatorSpecies: ['Baltic rush', 'Nebraska sedge', 'Plains cottonwood'],
    updatedAt: minutesAgo(12),
    syncState: 'synced',
  },
]

export const demoReadings: SensorReading[] = [
  {
    id: 'd1ae25ec-429f-4072-a44d-a349475c57f0',
    deviceId: 'cs-soil-001',
    fieldId: demoFields[0].id,
    siteId: null,
    label: 'Bed 4 moisture',
    measurement: 'soil_moisture',
    value: 31.4,
    unit: '%',
    quality: 'good',
    lorawan: {
      applicationId: 'aether-field',
      devEui: '0102030405060708',
      fPort: 10,
      frameCounter: 1432,
      gatewayIds: ['aether-gw-01'],
      rssi: -87,
      snr: 7.5,
      spreadingFactor: 7,
      frequencyHz: 904300000,
    },
    coordinate: {
      latitude: 39.7411,
      longitude: -104.9949,
      altitudeMeters: 1609,
      horizontalAccuracyMeters: 3,
      verticalAccuracyMeters: 5,
      headingDegrees: null,
    },
    recordedAt: minutesAgo(2),
  },
  {
    id: '9357da04-f56c-42e8-aa60-cbb88053cd97',
    deviceId: 'cs-water-003',
    fieldId: demoFields[1].id,
    siteId: null,
    label: 'Creek gauge',
    measurement: 'water_level',
    value: 0.42,
    unit: 'm',
    quality: 'good',
    lorawan: {
      applicationId: 'aether-field',
      devEui: '0807060504030201',
      fPort: 10,
      frameCounter: 889,
      gatewayIds: ['aether-gw-01'],
      rssi: -96,
      snr: 3.2,
      spreadingFactor: 9,
      frequencyHz: 904500000,
    },
    coordinate: {
      latitude: 39.7401,
      longitude: -104.9902,
      altitudeMeters: 1606,
      horizontalAccuracyMeters: 4,
      verticalAccuracyMeters: 6,
      headingDegrees: null,
    },
    recordedAt: minutesAgo(6),
  },
]

export const demoInsights: AlInsight[] = [
  {
    id: '93cfd0ca-62a6-4d20-ad31-feaa8628b864',
    title: 'Irrigate North Market Beds after sunset',
    summary:
      'Moisture remains adequate now; evening timing reduces evaporative loss.',
    rationale:
      'The current soil-moisture trend, crop stage, and air-temperature forecast favor evening irrigation.',
    sourceReadingIds: [demoReadings[0].id],
    fieldId: demoFields[0].id,
    siteId: null,
    severity: 'info',
    generatedAt: minutesAgo(3),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60_000).toISOString(),
    readOnly: true,
  },
]

export const demoAlerts: Alert[] = [
  {
    id: '084cc618-1227-422d-a75b-1aa09f537310',
    severity: 'warning',
    title: 'Riparian soil trending dry',
    detail: 'Three readings are below the 24% restoration threshold.',
    fieldId: demoFields[1].id,
    deviceId: 'cs-soil-009',
    createdAt: minutesAgo(18),
    acknowledgedAt: null,
  },
]

export const demoContacts: TakContact[] = [
  {
    uid: 'ANDROID-AETHER-01',
    callsign: 'Field One',
    team: 'Green',
    coordinate: {
      latitude: 39.7408,
      longitude: -104.9937,
      altitudeMeters: 1608,
      horizontalAccuracyMeters: 5,
      verticalAccuracyMeters: null,
      headingDegrees: 82,
    },
    staleAt: new Date(now.getTime() + 4 * 60_000).toISOString(),
  },
  {
    uid: 'AETHER-AL-001',
    callsign: 'Al',
    team: 'Green',
    coordinate: {
      latitude: 39.7398,
      longitude: -104.9955,
      altitudeMeters: 1607,
      horizontalAccuracyMeters: 8,
      verticalAccuracyMeters: null,
      headingDegrees: null,
    },
    staleAt: new Date(now.getTime() + 4 * 60_000).toISOString(),
  },
]

export const demoSnapshot: DashboardSnapshot = {
  properties: demoProperties,
  seasons: demoSeasons,
  fields: demoFields,
  ecologicalSites: demoEcologicalSites,
  readings: demoReadings,
  observations: [],
  alerts: demoAlerts,
  insights: demoInsights,
  contacts: demoContacts,
}
