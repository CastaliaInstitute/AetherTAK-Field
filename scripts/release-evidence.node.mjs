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
import { gunzipSync, gzipSync } from 'node:zlib'
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
  'field-api-health',
  'guardian-authorization',
  'background-tracking',
  'depth-capability',
  'field-sync',
  'tak-outbox',
  'guardian-actions',
  'offline-maps',
  'media-integrity',
  'network',
]

const readinessPrivacyExclusions = [
  'certificate and private-key material',
  'enrollment package passwords',
  'server addresses and profile identifiers',
  'device identifiers and personal device names',
  'coordinates and location history',
  'chat and TAK event contents',
  'observation notes and media contents',
]

const physicalPrivacyFlags = [
  'excludesCredentials',
  'excludesServerAddress',
  'excludesCoordinates',
  'excludesRecordAndMessageContent',
  'excludesMediaAndLogs',
  'excludesPersonalTesterIdentity',
]

const interoperabilityPrivacyFlags = [
  'excludesServerAddress',
  'excludesCoordinates',
  'excludesMessageContent',
  'excludesBinaryEvidence',
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
      supportsMesh: supportedDepth,
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
    privacy: { excludes: [...readinessPrivacyExclusions] },
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
      endsAt: now,
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
  assert.deepEqual(manifest.evidencePolicy, {
    maximumAgeDays: 30,
    allowedClockSkewSeconds: 300,
    readinessMustFollowPhysicalValidation: true,
    resultTimesMustFallWithinSessions: true,
    serverLogTimesMustFallWithinInteroperabilitySessions: true,
    privacyContractsRequired: true,
    maximumBundleBytes: 1_048_576,
    maximumReferenceCharacters: 240,
  })
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

test('requires a passing authenticated field service health check', () => {
  const missing = validBundle()
  missing.readinessReports[0].checks =
    missing.readinessReports[0].checks.filter(
      (check) => check.id !== 'field-api-health',
    )
  assert.throws(
    () => verifyReleaseEvidence(missing, expected()),
    /field-api-health did not pass/,
  )

  const failed = validBundle()
  failed.readinessReports[0].checks.find(
    (check) => check.id === 'field-api-health',
  ).status = 'fail'
  assert.throws(
    () => verifyReleaseEvidence(failed, expected()),
    /field-api-health did not pass/,
  )
})

test('rejects future-dated, stale, and out-of-session evidence', () => {
  const future = validBundle()
  future.physicalSessions[0].completedAt = '2026-07-30T12:06:00.000Z'
  future.physicalSessions[0].updatedAt = '2026-07-30T12:06:00.000Z'
  assert.throws(
    () => verifyReleaseEvidence(future, expected(), new Date(now)),
    /more than 5 minutes in the future/,
  )

  const stale = validBundle()
  stale.interoperabilitySessions[0].startedAt = '2026-06-29T12:00:00.000Z'
  assert.throws(
    () => verifyReleaseEvidence(stale, expected(), new Date(now)),
    /older than 30 days/,
  )

  const outside = validBundle()
  outside.physicalSessions[0].results[0].testedAt =
    '2026-07-30T11:59:59.000Z'
  assert.throws(
    () => verifyReleaseEvidence(outside, expected(), new Date(now)),
    /outside its session interval/,
  )

  const outsideInteroperability = validBundle()
  outsideInteroperability.interoperabilitySessions[0].results[0].testedAt =
    '2026-07-30T12:00:01.000Z'
  assert.throws(
    () =>
      verifyReleaseEvidence(
        outsideInteroperability,
        expected(),
        new Date('2026-07-30T12:01:00.000Z'),
      ),
    /outside its interoperability session/,
  )
})

test('requires readiness after physical exercises and bounded server logs', () => {
  const earlyReadiness = validBundle()
  earlyReadiness.physicalSessions[0].startedAt =
    '2026-07-30T11:59:00.000Z'
  earlyReadiness.physicalSessions[0].completedAt =
    '2026-07-30T12:01:00.000Z'
  earlyReadiness.physicalSessions[0].updatedAt =
    '2026-07-30T12:01:00.000Z'
  earlyReadiness.physicalSessions[0].results.forEach((result) => {
    result.testedAt = '2026-07-30T12:00:30.000Z'
  })
  assert.throws(
    () =>
      verifyReleaseEvidence(
        earlyReadiness,
        expected(),
        new Date('2026-07-30T12:02:00.000Z'),
      ),
    /No post-validation Device readiness report/,
  )

  const unboundedLog = validBundle()
  unboundedLog.interoperabilitySessions[0].serverLogInterval.startsAt =
    '2026-07-30T11:59:59.000Z'
  assert.throws(
    () => verifyReleaseEvidence(unboundedLog, expected(), new Date(now)),
    /outside its interoperability session/,
  )
})

test('requires every exported privacy contract without unexpected fields', () => {
  const readinessPrivacy = validBundle()
  readinessPrivacy.readinessReports[0].privacy.excludes.pop()
  assert.throws(
    () => verifyReleaseEvidence(readinessPrivacy, expected(), new Date(now)),
    /privacy exclusions are incomplete or unexpected/,
  )

  const physicalPrivacy = validBundle()
  physicalPrivacy.physicalSessions[0].privacy.excludesCredentials = false
  assert.throws(
    () => verifyReleaseEvidence(physicalPrivacy, expected(), new Date(now)),
    /excludesCredentials must be true/,
  )

  const interoperabilityPrivacy = validBundle()
  interoperabilityPrivacy.interoperabilitySessions[0].privacy.endpoint = true
  assert.throws(
    () =>
      verifyReleaseEvidence(
        interoperabilityPrivacy,
        expected(),
        new Date(now),
      ),
    /does not match the expected privacy contract/,
  )
})

test('standalone verifier mirrors all in-app evidence privacy declarations', async () => {
  const [readinessSource, physicalSource, interoperabilitySource, verifier] =
    await Promise.all([
      readFile(
        new URL('../src/device/readiness.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/release/evidence.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/interoperability/evidence.ts', import.meta.url),
        'utf8',
      ),
      readFile(new URL('./release-evidence.mjs', import.meta.url), 'utf8'),
    ])
  for (const exclusion of readinessPrivacyExclusions) {
    assert.ok(readinessSource.includes(`'${exclusion}'`))
    assert.ok(verifier.includes(`'${exclusion}'`))
  }
  for (const flag of physicalPrivacyFlags) {
    assert.ok(physicalSource.includes(`${flag}: z.literal(true)`))
    assert.ok(verifier.includes(`'${flag}'`))
  }
  for (const flag of interoperabilityPrivacyFlags) {
    assert.ok(
      interoperabilitySource.includes(`${flag}: z.literal(true)`),
    )
    assert.ok(verifier.includes(`'${flag}'`))
  }
})

test('rejects malformed IDs, duplicate checks, and unbounded references', () => {
  const malformedId = validBundle()
  malformedId.physicalSessions[0].id = 'not-a-session-id'
  assert.throws(
    () => verifyReleaseEvidence(malformedId, expected(), new Date(now)),
    /must be a UUID/,
  )

  const duplicateCheck = validBundle()
  duplicateCheck.readinessReports[0].checks.push({
    ...duplicateCheck.readinessReports[0].checks[0],
  })
  assert.throws(
    () => verifyReleaseEvidence(duplicateCheck, expected(), new Date(now)),
    /duplicate check/,
  )

  const unknownCheck = validBundle()
  unknownCheck.readinessReports[0].checks.at(-1).id = 'fabricated-check'
  assert.throws(
    () => verifyReleaseEvidence(unknownCheck, expected(), new Date(now)),
    /unknown check/,
  )

  const inconsistentVerdict = validBundle()
  inconsistentVerdict.readinessReports.find(
    (report) => report.overall === 'pass',
  ).overall = 'attention'
  assert.throws(
    () =>
      verifyReleaseEvidence(
        inconsistentVerdict,
        expected(),
        new Date(now),
      ),
    /overall verdict does not match/,
  )

  const oversizedReference = validBundle()
  oversizedReference.interoperabilitySessions[0]
    .serverLogInterval.reference = 'x'.repeat(241)
  assert.throws(
    () =>
      verifyReleaseEvidence(
        oversizedReference,
        expected(),
        new Date(now),
      ),
    /at most 240 characters/,
  )

  const oversizedBundle = validBundle()
  oversizedBundle.padding = 'x'.repeat(1024 * 1024)
  assert.throws(
    () => verifyReleaseEvidence(oversizedBundle, expected(), new Date(now)),
    /bundle exceeds 1 MiB/,
  )
})

test('collects, verifies, and encodes a private bundle through the CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aethertak-evidence-test-'))
  const input = join(directory, 'input')
  const bundlePath = join(directory, 'bundle.json')
  const manifestPath = join(directory, 'manifest.json')
  const encodedPath = join(directory, 'bundle.base64')
  const archivePath = join(directory, 'bundle.json.gz')
  const decodedPath = join(directory, 'decoded.json')
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
    await writeFile(archivePath, Buffer.from(encoded, 'base64'))
    execFileSync(process.execPath, [
      'scripts/release-evidence.mjs',
      'decode',
      '--input',
      archivePath,
      '--output',
      decodedPath,
    ])
    assert.deepEqual(
      JSON.parse(await readFile(decodedPath, 'utf8')),
      decoded,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bounded decoder rejects a compressed evidence expansion over 1 MiB', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aethertak-bomb-test-'))
  const archivePath = join(directory, 'oversized.json.gz')
  const outputPath = join(directory, 'oversized.json')
  try {
    await writeFile(
      archivePath,
      gzipSync(Buffer.alloc(1024 * 1024 + 1, 0x20)),
    )
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            'scripts/release-evidence.mjs',
            'decode',
            '--input',
            archivePath,
            '--output',
            outputPath,
          ],
          { stdio: 'pipe' },
        ),
      (error) =>
        String(error.stderr).includes('expands beyond 1 MiB'),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
