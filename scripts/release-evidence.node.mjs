import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import {
  collectReleaseEvidence,
  verifyReleaseEvidence,
} from './release-evidence.mjs'

const revision = '1234567890abcdef1234567890abcdef12345678'
const versionName = '0.2.0'
const buildNumber = '42'
const now = '2026-07-30T12:00:00.000Z'

const physicalChecks = [
  'enrollment_import',
  'enrollment_replacement',
  'offline_relaunch',
  'ordered_sync',
  'conflict_resolution',
  'photo_geotag_integrity',
  'video_geotag_integrity',
  'media_roundtrip',
  'depth_known_dimension',
  'depth_artifacts',
  'depth_fallback',
  'background_lock',
  'permission_revocation',
  'airplane_mode',
  'low_storage',
]

const interoperabilityCapabilities = [
  'pli',
  'background_pli',
  'geochat',
  'marker',
  'route',
  'open_shape',
  'closed_shape',
  'emergency_start',
  'emergency_cancel',
  'mission_package',
  'reconnect',
  'stale_removal',
]

const readinessCheckIds = [
  'native-runtime',
  'physical-device',
  'tak-enrollment',
  'tak-connection',
  'background-tracking',
  'depth-capability',
  'field-sync',
  'tak-outbox',
  'offline-maps',
  'media-integrity',
  'network',
]

function app() {
  return {
    name: 'AetherTAK Field',
    id: 'org.castaliainstitute.aethertak.field',
    version: versionName,
    build: buildNumber,
    sourceRevision: revision,
  }
}

function readiness(platform, model, supportedDepth) {
  const osVersion = platform === 'ios' ? '19.0' : '17'
  return {
    schemaVersion: 1,
    generatedAt: now,
    overall: supportedDepth ? 'pass' : 'attention',
    app: app(),
    device: {
      platform,
      operatingSystem: platform,
      osVersion,
      model,
      manufacturer: platform === 'ios' ? 'Apple' : 'Google',
      isVirtual: false,
      webViewVersion: '1',
    },
    runtime: {
      native: true,
      online: true,
      storageEstimateBytes: 1,
      storageQuotaBytes: 2,
      contactCount: 2,
    },
    tak: { state: 'connected', profile: {}, lastConnectedAt: now },
    backgroundTracking: { supported: true, enabled: true, detail: 'Active' },
    depth: {
      supported: supportedDepth,
      provider: supportedDepth
        ? platform === 'ios' ? 'arkit-lidar' : 'arcore-depth'
        : 'none',
      supportsPointCloud: supportedDepth,
      supportsMesh: platform === 'ios' && supportedDepth,
      supportsConfidence: supportedDepth,
      reason: supportedDepth ? null : 'Unavailable',
    },
    database: {},
    checks: readinessCheckIds.map((id) => ({
      id,
      label: id,
      status:
        id === 'depth-capability' && !supportedDepth ? 'attention' : 'pass',
      detail: 'Recorded.',
    })),
    privacy: { excludes: [] },
  }
}

function physical(platform, model, supportedDepth, id) {
  const osVersion = platform === 'ios' ? '19.0' : '17'
  return {
    schemaVersion: 1,
    id,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    release: {
      appVersion: versionName,
      build: buildNumber,
      sourceRevision: revision,
    },
    device: {
      platform,
      model,
      operatingSystem: platform,
      osVersion,
      isVirtual: false,
    },
    evidenceSetReference: `RC/${id}`,
    results: physicalChecks.map((check) => {
      const notApplicable =
        supportedDepth
          ? check === 'depth_fallback'
          : check === 'depth_known_dimension' || check === 'depth_artifacts'
      return {
        check,
        status: notApplicable ? 'not_applicable' : 'pass',
        testedAt: now,
        evidenceReference: notApplicable ? '' : `evidence/${id}/${check}`,
        notes: notApplicable ? 'Covered by a companion device.' : '',
        depthMeasurement:
          check === 'depth_known_dimension' && supportedDepth
            ? {
                knownDistanceMeters: 2,
                measuredDistanceMeters: 2.04,
                tolerancePercent: 5,
                absoluteErrorPercent: 2,
              }
            : null,
      }
    }),
    privacy: {
      excludesCredentials: true,
      excludesServerAddress: true,
      excludesCoordinates: true,
      excludesRecordAndMessageContent: true,
      excludesMediaAndLogs: true,
      excludesPersonalTesterIdentity: true,
    },
  }
}

function interoperability(peer, fieldPlatform, id) {
  return {
    schemaVersion: 1,
    id,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    peer: {
      client: peer,
      version: peer === 'iTAK' ? '2.9' : '5.5',
      deviceModel: peer === 'iTAK' ? 'iPhone 16' : 'Pixel 10',
      osVersion: peer === 'iTAK' ? 'iOS 19' : 'Android 17',
    },
    field: {
      appVersion: versionName,
      build: buildNumber,
      sourceRevision: revision,
      platform: fieldPlatform,
      deviceModel:
        fieldPlatform === 'ios' ? 'iPhone 16 Pro' : 'Pixel 10 Pro',
      osVersion:
        fieldPlatform === 'ios' ? 'ios 19.0' : 'android 17',
    },
    serverVersion: 'AetherTAK 1.0',
    senderCallsign: 'Field One',
    recipientCallsign: `${peer} One`,
    serverLogInterval: {
      startsAt: now,
      endsAt: '2026-07-30T12:15:00.000Z',
      reference: `logs/${id}`,
    },
    results: interoperabilityCapabilities.flatMap((capability) =>
      ['field_to_peer', 'peer_to_field'].map((direction) => ({
        capability,
        direction,
        status: 'pass',
        testedAt: now,
        evidenceReference: `evidence/${id}/${capability}/${direction}`,
        notes: '',
      })),
    ),
    privacy: {
      excludesServerAddress: true,
      excludesCoordinates: true,
      excludesMessageContent: true,
      excludesBinaryEvidence: true,
    },
  }
}

function validDocuments() {
  return [
    {
      fileName: 'ios-readiness.json',
      document: readiness('ios', 'iPhone 16 Pro', true),
    },
    {
      fileName: 'android-readiness.json',
      document: readiness('android', 'Pixel 10 Pro', true),
    },
    {
      fileName: 'fallback-readiness.json',
      document: readiness('android', 'Pixel 8a', false),
    },
    {
      fileName: 'ios-physical.json',
      document: physical(
        'ios',
        'iPhone 16 Pro',
        true,
        '11111111-1111-4111-8111-111111111111',
      ),
    },
    {
      fileName: 'android-physical.json',
      document: physical(
        'android',
        'Pixel 10 Pro',
        true,
        '22222222-2222-4222-8222-222222222222',
      ),
    },
    {
      fileName: 'fallback-physical.json',
      document: physical(
        'android',
        'Pixel 8a',
        false,
        '33333333-3333-4333-8333-333333333333',
      ),
    },
    {
      fileName: 'ios-itak.json',
      document: interoperability(
        'iTAK',
        'ios',
        '44444444-4444-4444-8444-444444444444',
      ),
    },
    {
      fileName: 'ios-atak.json',
      document: interoperability(
        'ATAK',
        'ios',
        '55555555-5555-4555-8555-555555555555',
      ),
    },
    {
      fileName: 'android-itak.json',
      document: interoperability(
        'iTAK',
        'android',
        '66666666-6666-4666-8666-666666666666',
      ),
    },
    {
      fileName: 'android-atak.json',
      document: interoperability(
        'ATAK',
        'android',
        '77777777-7777-4777-8777-777777777777',
      ),
    },
  ]
}

function validBundle() {
  return collectReleaseEvidence({
    versionName,
    buildNumber,
    sourceRevision: revision,
    documents: validDocuments(),
  })
}

function expected(platform = 'both') {
  return {
    versionName,
    buildNumber,
    sourceRevision: revision,
    platform,
    itakVersion: '2.9',
    atakVersion: '5.5',
    serverVersion: 'AetherTAK 1.0',
  }
}

test('builds and verifies a complete private multi-device evidence bundle', () => {
  const bundle = validBundle()
  const manifest = verifyReleaseEvidence(
    bundle,
    expected(),
    new Date(now),
  )
  assert.equal(manifest.verdict, 'pass')
  assert.deepEqual(manifest.coverage.physicalPlatforms, ['android', 'ios'])
  assert.deepEqual(manifest.coverage.supportedDepthPlatforms, ['android', 'ios'])
  assert.equal(manifest.coverage.unsupportedDepthDevices, 1)
  assert.deepEqual(manifest.coverage.peerClients, ['ATAK', 'iTAK'])
  assert.deepEqual(
    manifest.coverage.interoperabilityPlatforms,
    ['android', 'ios'],
  )
  assert.match(manifest.evidenceBundleSha256, /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(manifest).includes('evidence/'), false)
  assert.equal(JSON.stringify(manifest).includes('Field One'), false)
})

test('fails closed when physical evidence does not match the exact source revision', () => {
  const bundle = validBundle()
  bundle.physicalSessions[0].release.sourceRevision = 'wrong'
  assert.throws(
    () => verifyReleaseEvidence(bundle, expected()),
    /source revision/,
  )
})

test('requires supported depth on every target platform and a real fallback device', () => {
  const bundle = validBundle()
  bundle.physicalSessions = bundle.physicalSessions.filter(
    (session) => session.device.model !== 'Pixel 8a',
  )
  bundle.readinessReports = bundle.readinessReports.filter(
    (report) => report.device.model !== 'Pixel 8a',
  )
  assert.throws(
    () => verifyReleaseEvidence(bundle, expected()),
    /unsupported-depth fallback/,
  )
})

test('rejects incomplete or failing bidirectional released-client evidence', () => {
  const bundle = validBundle()
  const atak = bundle.interoperabilitySessions.find(
    (session) => session.peer.client === 'ATAK',
  )
  atak.results.find(
    (result) =>
      result.capability === 'mission_package' &&
      result.direction === 'peer_to_field',
  ).status = 'fail'
  assert.throws(
    () => verifyReleaseEvidence(bundle, expected()),
    /mission_package:peer_to_field did not pass/,
  )
})

test('requires each target Field platform against both declared peer versions', () => {
  const missingPair = validBundle()
  missingPair.interoperabilitySessions =
    missingPair.interoperabilitySessions.filter(
      (session) =>
        !(
          session.field.platform === 'android' &&
          session.peer.client === 'iTAK'
        ),
    )
  assert.throws(
    () => verifyReleaseEvidence(missingPair, expected()),
    /android Field to iTAK/,
  )

  const wrongVersion = validBundle()
  wrongVersion.interoperabilitySessions.find(
    (session) => session.peer.client === 'iTAK',
  ).peer.version = 'old'
  assert.throws(
    () => verifyReleaseEvidence(wrongVersion, expected()),
    /iTAK version does not match/,
  )
})

test('recomputes depth error from the raw distances', () => {
  const bundle = validBundle()
  const supported = bundle.physicalSessions.find(
    (session) => session.device.model === 'iPhone 16 Pro',
  )
  supported.results.find(
    (result) => result.check === 'depth_known_dimension',
  ).depthMeasurement.absoluteErrorPercent = 0
  assert.throws(
    () => verifyReleaseEvidence(bundle, expected()),
    /depth error does not match/,
  )
})

test('rejects readiness from a simulator or with a required attention check', () => {
  const virtualBundle = validBundle()
  virtualBundle.readinessReports[0].device.isVirtual = true
  assert.throws(
    () => verifyReleaseEvidence(virtualBundle, expected()),
    /virtual device/,
  )

  const queueBundle = validBundle()
  queueBundle.readinessReports[0].checks.find(
    (check) => check.id === 'field-sync',
  ).status = 'attention'
  assert.throws(
    () => verifyReleaseEvidence(queueBundle, expected()),
    /field-sync did not pass/,
  )
})

test('collects, verifies, and encodes a private bundle through the CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aethertak-evidence-test-'))
  const input = join(directory, 'input')
  const bundlePath = join(directory, 'bundle.json')
  const manifestPath = join(directory, 'manifest.json')
  const encodedPath = join(directory, 'bundle.base64')
  try {
    await mkdir(input)
    await Promise.all(
      validDocuments().map(({ fileName, document }) =>
        writeFile(join(input, fileName), JSON.stringify(document)),
      ),
    )
    execFileSync(process.execPath, [
      'scripts/release-evidence.mjs',
      'collect',
      '--input-dir',
      input,
      '--version',
      versionName,
      '--build',
      buildNumber,
      '--revision',
      revision,
      '--output',
      bundlePath,
    ])
    execFileSync(process.execPath, [
      'scripts/release-evidence.mjs',
      'verify',
      '--bundle',
      bundlePath,
      '--version',
      versionName,
      '--build',
      buildNumber,
      '--revision',
      revision,
      '--platform',
      'both',
      '--itak-version',
      '2.9',
      '--atak-version',
      '5.5',
      '--server-version',
      'AetherTAK 1.0',
      '--manifest-out',
      manifestPath,
    ])
    execFileSync(process.execPath, [
      'scripts/release-evidence.mjs',
      'encode',
      '--bundle',
      bundlePath,
      '--output',
      encodedPath,
    ])
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(manifest.verdict, 'pass')
    const encoded = (await readFile(encodedPath, 'utf8')).trim()
    const decoded = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')))
    assert.equal(decoded.sourceRevision, revision)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
