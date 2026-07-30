import { createHash } from 'node:crypto'
import {
  chmod,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

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

const requiredReadinessChecks = [
  'native-runtime',
  'physical-device',
  'tak-enrollment',
  'tak-connection',
  'field-api-health',
  'guardian-authorization',
  'background-tracking',
  'field-sync',
  'tak-outbox',
  'guardian-actions',
  'offline-maps',
  'media-integrity',
]

const readinessChecks = [
  ...requiredReadinessChecks,
  'depth-capability',
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

const maximumEvidenceAgeMs = 30 * 24 * 60 * 60 * 1_000
const allowedClockSkewMs = 5 * 60 * 1_000
const maximumEvidenceBundleBytes = 1024 * 1024
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fail(message) {
  throw new Error(message)
}

function requireValue(condition, message) {
  if (!condition) fail(message)
}

function object(value, label) {
  requireValue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object.`,
  )
  return value
}

function string(value, label) {
  requireValue(typeof value === 'string' && value.length > 0, `${label} is required.`)
  return value
}

function boundedString(value, label, maximum, allowEmpty = false) {
  requireValue(typeof value === 'string', `${label} must be a string.`)
  requireValue(
    (allowEmpty || value.trim().length > 0) && value.length <= maximum,
    `${label} must contain at most ${maximum} characters${allowEmpty ? '' : ' and cannot be empty'}.`,
  )
  return value
}

function uuid(value, label) {
  requireValue(
    typeof value === 'string' && uuidPattern.test(value),
    `${label} must be a UUID.`,
  )
  return value
}

function exactTrueFlags(value, keys, label) {
  const privacy = object(value, label)
  const actualKeys = Object.keys(privacy).sort()
  const expectedKeys = [...keys].sort()
  requireValue(
    actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) => key === expectedKeys[index]),
    `${label} does not match the expected privacy contract.`,
  )
  for (const key of keys) {
    requireValue(
      privacy[key] === true,
      `${label} flag ${key} must be true.`,
    )
  }
}

function validateReadinessPrivacy(value) {
  const privacy = object(value, 'Readiness privacy')
  requireValue(
    Object.keys(privacy).length === 1 &&
      Object.hasOwn(privacy, 'excludes'),
    'Readiness privacy does not match the expected privacy contract.',
  )
  const exclusions = array(privacy.excludes, 'Readiness privacy exclusions')
  requireValue(
    exclusions.length === readinessPrivacyExclusions.length &&
      new Set(exclusions).size === exclusions.length &&
      readinessPrivacyExclusions.every((entry) => exclusions.includes(entry)),
    'Readiness privacy exclusions are incomplete or unexpected.',
  )
}

function timestamp(value, label) {
  const parsed = Date.parse(string(value, label))
  requireValue(Number.isFinite(parsed), `${label} is not a valid timestamp.`)
  return parsed
}

function verificationClock(now) {
  requireValue(
    now instanceof Date && Number.isFinite(now.getTime()),
    'Verification time is invalid.',
  )
  return {
    oldest: now.getTime() - maximumEvidenceAgeMs,
    latest: now.getTime() + allowedClockSkewMs,
  }
}

function evidenceTimestamp(value, label, clock) {
  const parsed = timestamp(value, label)
  requireValue(parsed >= clock.oldest, `${label} is older than 30 days.`)
  requireValue(
    parsed <= clock.latest,
    `${label} is more than 5 minutes in the future.`,
  )
  return parsed
}

function orderedInterval(startsAt, endsAt, label) {
  requireValue(startsAt <= endsAt, `${label} ends before it starts.`)
}

function array(value, label) {
  requireValue(Array.isArray(value), `${label} must be an array.`)
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function documentDigest(value) {
  return sha256(stableJson(value))
}

async function writePrivate(path, contents) {
  await writeFile(path, contents, { mode: 0o600 })
  await chmod(path, 0o600)
}

function classify(document, fileName = 'evidence document') {
  const value = object(document, fileName)
  if (value.schemaVersion !== 1) {
    fail(`${fileName} has an unsupported schema version.`)
  }
  if (value.app && value.database && value.checks) return 'readiness'
  if (value.release && value.device && value.results) return 'physical'
  if (value.peer && value.field && value.results) return 'interoperability'
  fail(`${fileName} is not a recognized AetherTAK Field evidence export.`)
}

function sortedByDigest(values) {
  return [...values].sort((left, right) =>
    documentDigest(left).localeCompare(documentDigest(right)),
  )
}

export function collectReleaseEvidence({
  versionName,
  buildNumber,
  sourceRevision,
  documents,
}) {
  string(versionName, 'Version')
  string(buildNumber, 'Build number')
  string(sourceRevision, 'Source revision')
  const readinessReports = []
  const physicalSessions = []
  const interoperabilitySessions = []
  for (const entry of documents) {
    const kind = classify(entry.document, entry.fileName)
    if (kind === 'readiness') readinessReports.push(entry.document)
    if (kind === 'physical') physicalSessions.push(entry.document)
    if (kind === 'interoperability') {
      interoperabilitySessions.push(entry.document)
    }
  }
  requireValue(readinessReports.length > 0, 'No Device readiness reports were provided.')
  requireValue(physicalSessions.length > 0, 'No Device validation sessions were provided.')
  requireValue(
    interoperabilitySessions.length > 0,
    'No iTAK/ATAK interoperability sessions were provided.',
  )
  return {
    schemaVersion: 1,
    versionName,
    buildNumber,
    sourceRevision,
    readinessReports: sortedByDigest(readinessReports),
    physicalSessions: sortedByDigest(physicalSessions),
    interoperabilitySessions: sortedByDigest(interoperabilitySessions),
  }
}

function exactBuild(record, expected, label) {
  const appVersion = record.appVersion ?? record.version
  requireValue(
    appVersion === expected.versionName,
    `${label} app version does not match ${expected.versionName}.`,
  )
  requireValue(
    String(record.build) === expected.buildNumber,
    `${label} build does not match ${expected.buildNumber}.`,
  )
  requireValue(
    record.sourceRevision === expected.sourceRevision,
    `${label} source revision does not match ${expected.sourceRevision}.`,
  )
}

function uniqueResults(results, ids, key, label) {
  const map = new Map()
  for (const resultValue of array(results, `${label} results`)) {
    const result = object(resultValue, `${label} result`)
    const id = result[key]
    requireValue(ids.includes(id), `${label} has an unknown ${key}: ${id}.`)
    requireValue(!map.has(id), `${label} has duplicate ${key}: ${id}.`)
    map.set(id, result)
  }
  requireValue(
    map.size === ids.length,
    `${label} does not contain the complete ${key} matrix.`,
  )
  return map
}

function validateReadiness(reportValue, expected, clock) {
  const report = object(reportValue, 'Device readiness report')
  requireValue(report.schemaVersion === 1, 'Unsupported readiness schema.')
  const generatedAt = evidenceTimestamp(
    report.generatedAt,
    'Readiness generation time',
    clock,
  )
  const app = object(report.app, 'Readiness app')
  exactBuild(app, expected, 'Readiness report')
  requireValue(
    app.id === 'org.castaliainstitute.aethertak.field',
    'Readiness report has the wrong application identifier.',
  )
  boundedString(app.name, 'Readiness application name', 120)
  boundedString(app.version, 'Readiness application version', 80)
  boundedString(String(app.build), 'Readiness application build', 80)
  boundedString(app.sourceRevision, 'Readiness source revision', 80)
  const device = object(report.device, 'Readiness device')
  requireValue(
    device.platform === 'ios' || device.platform === 'android',
    'Readiness report must come from iOS or Android.',
  )
  requireValue(device.isVirtual === false, 'Readiness report came from a virtual device.')
  boundedString(device.model, 'Readiness device model', 120)
  boundedString(device.operatingSystem, 'Readiness operating system', 120)
  boundedString(device.osVersion, 'Readiness OS version', 120)
  boundedString(device.manufacturer, 'Readiness manufacturer', 120, true)
  boundedString(device.webViewVersion, 'Readiness WebView version', 120, true)
  const runtime = object(report.runtime, 'Readiness runtime')
  requireValue(runtime.native === true, 'Readiness report did not come from the native app.')
  requireValue(typeof runtime.online === 'boolean', 'Readiness online state is invalid.')
  requireValue(
    Number.isInteger(runtime.contactCount) && runtime.contactCount >= 0,
    'Readiness contact count is invalid.',
  )
  requireValue(
    report.overall === 'pass' || report.overall === 'attention',
    'Readiness overall verdict is not releasable.',
  )
  const checks = new Map()
  for (const checkValue of array(report.checks, 'Readiness checks')) {
    const check = object(checkValue, 'Readiness check')
    boundedString(check.id, 'Readiness check ID', 80)
    requireValue(
      readinessChecks.includes(check.id),
      `Readiness report has an unknown check ${check.id}.`,
    )
    boundedString(check.label, `Readiness check ${check.id} label`, 120)
    boundedString(check.detail, `Readiness check ${check.id} detail`, 1_000)
    requireValue(
      check.status === 'pass' ||
        check.status === 'attention' ||
        check.status === 'fail',
      `Readiness check ${check.id} has an invalid status.`,
    )
    requireValue(
      !checks.has(check.id),
      `Readiness report has duplicate check ${check.id}.`,
    )
    checks.set(check.id, check)
  }
  for (const id of requiredReadinessChecks) {
    requireValue(
      checks.get(id)?.status === 'pass',
      `Readiness check ${id} did not pass on ${device.model}.`,
    )
  }
  requireValue(
    checks.size === readinessChecks.length,
    'Readiness report does not contain the complete check matrix.',
  )
  const derivedOverall = [...checks.values()].some(
    (check) => check.status === 'fail',
  )
    ? 'fail'
    : [...checks.values()].some((check) => check.status === 'attention')
      ? 'attention'
      : 'pass'
  requireValue(
    report.overall === derivedOverall,
    'Readiness overall verdict does not match its check results.',
  )
  const depth = object(report.depth, 'Readiness depth')
  requireValue(
    typeof depth.supported === 'boolean' &&
      typeof depth.supportsPointCloud === 'boolean' &&
      typeof depth.supportsMesh === 'boolean' &&
      typeof depth.supportsConfidence === 'boolean',
    'Readiness depth capability flags are invalid.',
  )
  boundedString(depth.provider, 'Readiness depth provider', 80)
  if (depth.supported) {
    const expectedProvider = device.platform === 'ios' ? 'arkit' : 'arcore'
    requireValue(
      String(depth.provider).toLowerCase().includes(expectedProvider),
      `${device.platform} depth report does not identify ${expectedProvider}.`,
    )
    requireValue(depth.supportsPointCloud === true, 'Supported depth lacks point-cloud capability.')
  } else {
    requireValue(
      depth.provider === 'none' &&
        depth.supportsPointCloud === false &&
        depth.supportsMesh === false &&
        depth.supportsConfidence === false,
      'Unsupported depth report claims native depth capabilities.',
    )
  }
  validateReadinessPrivacy(report.privacy)
  return {
    report,
    device,
    depth,
    generatedAt,
    digest: documentDigest(report),
  }
}

function matchingReadiness(session, readiness) {
  const completedAt = timestamp(
    session.completedAt,
    'Device validation completion',
  )
  return readiness.find(({ report, device, generatedAt }) =>
    device.platform === session.device.platform &&
    device.model === session.device.model &&
    device.operatingSystem === session.device.operatingSystem &&
    device.osVersion === session.device.osVersion &&
    report.app.version === session.release.appVersion &&
    String(report.app.build) === String(session.release.build) &&
    report.app.sourceRevision === session.release.sourceRevision &&
    generatedAt >= completedAt,
  )
}

function completePhysicalResult(result, label, interval, clock) {
  requireValue(result.status !== 'pending', `${label} is still pending.`)
  const testedAt = evidenceTimestamp(
    result.testedAt,
    `${label} test timestamp`,
    clock,
  )
  requireValue(
    testedAt >= interval.startsAt && testedAt <= interval.completedAt,
    `${label} test timestamp is outside its session interval.`,
  )
  if (result.status === 'not_applicable') {
    boundedString(result.notes, `${label} notes`, 500)
    requireValue(
      typeof result.notes === 'string' && result.notes.trim().length > 0,
      `${label} N/A has no justification.`,
    )
  } else {
    boundedString(
      result.evidenceReference,
      `${label} evidence reference`,
      240,
    )
    boundedString(result.notes, `${label} notes`, 500, true)
    requireValue(
      typeof result.evidenceReference === 'string' &&
        result.evidenceReference.trim().length > 0,
      `${label} has no controlled evidence reference.`,
    )
  }
  requireValue(
    result.status !== 'fail' && result.status !== 'blocked',
    `${label} is ${result.status}.`,
  )
}

function validatePhysicalSession(sessionValue, expected, readiness, clock) {
  const session = object(sessionValue, 'Device validation session')
  requireValue(session.schemaVersion === 1, 'Unsupported device validation schema.')
  uuid(session.id, 'Device validation ID')
  boundedString(
    session.evidenceSetReference,
    'Device validation evidence-set reference',
    240,
  )
  const interval = {
    startsAt: evidenceTimestamp(
      session.startedAt,
      'Device validation start',
      clock,
    ),
    completedAt: evidenceTimestamp(
      session.completedAt,
      'Device validation completion',
      clock,
    ),
  }
  orderedInterval(
    interval.startsAt,
    interval.completedAt,
    'Device validation session',
  )
  const updatedAt = evidenceTimestamp(
    session.updatedAt,
    'Device validation update',
    clock,
  )
  requireValue(
    updatedAt >= interval.completedAt,
    'Device validation update predates completion.',
  )
  exactBuild(
    object(session.release, 'Device validation release'),
    expected,
    'Device validation session',
  )
  const device = object(session.device, 'Device validation device')
  requireValue(device.isVirtual === false, 'Device validation used a virtual device.')
  requireValue(
    device.platform === 'ios' || device.platform === 'android',
    'Device validation must come from iOS or Android.',
  )
  boundedString(device.model, 'Device validation model', 120)
  boundedString(
    device.operatingSystem,
    'Device validation operating system',
    120,
  )
  boundedString(device.osVersion, 'Device validation OS version', 120)
  exactTrueFlags(
    session.privacy,
    physicalPrivacyFlags,
    'Device validation privacy',
  )
  const results = uniqueResults(
    session.results,
    physicalChecks,
    'check',
    `Device validation ${session.id}`,
  )
  for (const [id, result] of results) {
    completePhysicalResult(
      result,
      `${device.model} ${id}`,
      interval,
      clock,
    )
  }
  const readinessMatch = matchingReadiness(session, readiness)
  requireValue(
    readinessMatch,
    `No post-validation Device readiness report for ${device.platform} ${device.model}.`,
  )
  const supportedDepth = readinessMatch.depth.supported === true
  for (const id of physicalChecks) {
    const result = results.get(id)
    if (id === 'depth_fallback') {
      requireValue(
        supportedDepth
          ? result.status === 'pass' || result.status === 'not_applicable'
          : result.status === 'pass',
        `${device.model} has an invalid unsupported-depth fallback result.`,
      )
    } else if (id === 'depth_known_dimension' || id === 'depth_artifacts') {
      requireValue(
        supportedDepth
          ? result.status === 'pass'
          : result.status === 'not_applicable',
        `${device.model} has an invalid ${id} result for its depth capability.`,
      )
    } else {
      requireValue(
        result.status === 'pass',
        `${device.model} required check ${id} did not pass.`,
      )
    }
  }
  if (supportedDepth) {
    const measurement = object(
      results.get('depth_known_dimension').depthMeasurement,
      `${device.model} depth measurement`,
    )
    requireValue(
      Number.isFinite(measurement.knownDistanceMeters) &&
        measurement.knownDistanceMeters > 0 &&
        Number.isFinite(measurement.measuredDistanceMeters) &&
        measurement.measuredDistanceMeters > 0 &&
        Number.isFinite(measurement.tolerancePercent) &&
        measurement.tolerancePercent > 0 &&
        measurement.tolerancePercent <= 100,
      `${device.model} depth measurement contains invalid values.`,
    )
    const derivedError =
      Math.abs(
        measurement.measuredDistanceMeters - measurement.knownDistanceMeters,
      ) / measurement.knownDistanceMeters * 100
    requireValue(
      Math.abs(derivedError - measurement.absoluteErrorPercent) < 0.000_001,
      `${device.model} depth error does not match its recorded distances.`,
    )
    requireValue(
      derivedError <= measurement.tolerancePercent,
      `${device.model} depth measurement exceeded its tolerance.`,
    )
  }
  return {
    session,
    device,
    supportedDepth,
    digest: documentDigest(session),
  }
}

function validateInteroperabilitySession(sessionValue, expected, clock) {
  const session = object(sessionValue, 'Interoperability session')
  requireValue(session.schemaVersion === 1, 'Unsupported interoperability schema.')
  uuid(session.id, 'Interoperability session ID')
  const sessionStartsAt = evidenceTimestamp(
    session.startedAt,
    'Interoperability start',
    clock,
  )
  const sessionCompletedAt = evidenceTimestamp(
    session.completedAt,
    'Interoperability completion',
    clock,
  )
  orderedInterval(
    sessionStartsAt,
    sessionCompletedAt,
    'Interoperability session',
  )
  const updatedAt = evidenceTimestamp(
    session.updatedAt,
    'Interoperability update',
    clock,
  )
  requireValue(
    updatedAt >= sessionCompletedAt,
    'Interoperability update predates completion.',
  )
  exactBuild(object(session.field, 'Interoperability field build'), expected, 'Interoperability session')
  requireValue(
    session.peer?.client === 'iTAK' || session.peer?.client === 'ATAK',
    'Interoperability peer must be iTAK or ATAK.',
  )
  boundedString(session.peer.version, 'Peer version', 80)
  boundedString(session.peer.deviceModel, 'Peer device model', 120)
  boundedString(session.peer.osVersion, 'Peer OS version', 120)
  boundedString(session.field.deviceModel, 'Field device model', 120)
  boundedString(session.field.osVersion, 'Field OS version', 120)
  boundedString(session.serverVersion, 'TAK Server version', 120)
  boundedString(session.senderCallsign, 'Field callsign', 80)
  boundedString(session.recipientCallsign, 'Peer callsign', 80)
  exactTrueFlags(
    session.privacy,
    interoperabilityPrivacyFlags,
    'Interoperability privacy',
  )
  const expectedPeerVersion =
    session.peer.client === 'iTAK' ? expected.itakVersion : expected.atakVersion
  requireValue(
    session.peer.version === expectedPeerVersion,
    `${session.peer.client} version does not match ${expectedPeerVersion}.`,
  )
  requireValue(
    session.serverVersion === expected.serverVersion,
    `TAK Server version does not match ${expected.serverVersion}.`,
  )
  const fieldPlatform =
    session.field.platform ??
    (String(session.field.osVersion).toLowerCase().startsWith('ios')
      ? 'ios'
      : String(session.field.osVersion).toLowerCase().startsWith('android')
        ? 'android'
        : null)
  requireValue(
    fieldPlatform === 'ios' || fieldPlatform === 'android',
    'Interoperability session does not identify the Field platform.',
  )
  const interval = object(session.serverLogInterval, 'Server log interval')
  const startsAt = evidenceTimestamp(
    interval.startsAt,
    'Server log start',
    clock,
  )
  const endsAt = evidenceTimestamp(
    interval.endsAt,
    'Server log end',
    clock,
  )
  orderedInterval(startsAt, endsAt, 'Server log interval')
  requireValue(
    startsAt >= sessionStartsAt && endsAt <= sessionCompletedAt,
    'Server log interval is outside its interoperability session.',
  )
  boundedString(
    interval.reference,
    'Controlled server log reference',
    240,
  )
  const expectedPairs = new Set(
    interoperabilityCapabilities.flatMap((capability) => [
      `${capability}:field_to_peer`,
      `${capability}:peer_to_field`,
    ]),
  )
  const actualPairs = new Set()
  for (const resultValue of array(session.results, 'Interoperability results')) {
    const result = object(resultValue, 'Interoperability result')
    const pair = `${result.capability}:${result.direction}`
    requireValue(expectedPairs.has(pair), `Unknown interoperability result ${pair}.`)
    requireValue(!actualPairs.has(pair), `Duplicate interoperability result ${pair}.`)
    actualPairs.add(pair)
    requireValue(result.status === 'pass', `Interoperability result ${pair} did not pass.`)
    const testedAt = evidenceTimestamp(
      result.testedAt,
      `${pair} timestamp`,
      clock,
    )
    requireValue(
      testedAt >= sessionStartsAt && testedAt <= sessionCompletedAt,
      `${pair} timestamp is outside its interoperability session.`,
    )
    boundedString(result.evidenceReference, `${pair} evidence reference`, 240)
    boundedString(result.notes, `${pair} notes`, 500, true)
  }
  requireValue(
    actualPairs.size === expectedPairs.size,
    'Interoperability session does not contain the complete bidirectional matrix.',
  )
  return {
    session,
    fieldPlatform,
    digest: documentDigest(session),
  }
}

function requiredPlatforms(value) {
  if (value === 'both') return ['ios', 'android']
  if (value === 'ios' || value === 'android') return [value]
  fail(`Invalid release platform: ${value}.`)
}

export function verifyReleaseEvidence(bundleValue, expected, now = new Date()) {
  const clock = verificationClock(now)
  const bundle = object(bundleValue, 'Release evidence bundle')
  requireValue(
    Buffer.byteLength(JSON.stringify(bundle)) <= maximumEvidenceBundleBytes,
    'Release evidence bundle exceeds 1 MiB.',
  )
  requireValue(bundle.schemaVersion === 1, 'Unsupported release evidence bundle schema.')
  requireValue(bundle.versionName === expected.versionName, 'Evidence bundle version mismatch.')
  requireValue(String(bundle.buildNumber) === expected.buildNumber, 'Evidence bundle build mismatch.')
  requireValue(bundle.sourceRevision === expected.sourceRevision, 'Evidence bundle revision mismatch.')
  const platforms = requiredPlatforms(expected.platform)
  const readiness = array(bundle.readinessReports, 'Readiness reports').map(
    (report) => validateReadiness(report, expected, clock),
  )
  const physical = array(bundle.physicalSessions, 'Device validation sessions').map(
    (session) => validatePhysicalSession(session, expected, readiness, clock),
  )
  const interoperability = array(
    bundle.interoperabilitySessions,
    'Interoperability sessions',
  ).map((session) => validateInteroperabilitySession(session, expected, clock))

  for (const platform of platforms) {
    requireValue(
      physical.some((entry) => entry.device.platform === platform),
      `No passing physical ${platform} validation session.`,
    )
    requireValue(
      physical.some(
        (entry) =>
          entry.device.platform === platform && entry.supportedDepth,
      ),
      `No supported-depth physical ${platform} validation session.`,
    )
    for (const peer of ['iTAK', 'ATAK']) {
      requireValue(
        interoperability.some(
          (entry) =>
            entry.fieldPlatform === platform &&
            entry.session.peer.client === peer,
        ),
        `No complete passing ${platform} Field to ${peer} interoperability session.`,
      )
    }
  }
  requireValue(
    physical.some((entry) => !entry.supportedDepth),
    'No physical unsupported-depth fallback session.',
  )
  const usedReadiness = new Set(
    physical.map((entry) => matchingReadiness(entry.session, readiness)?.digest),
  )
  const manifest = {
    schemaVersion: 1,
    verifiedAt: now.toISOString(),
    release: {
      versionName: expected.versionName,
      buildNumber: expected.buildNumber,
      sourceRevision: expected.sourceRevision,
      platform: expected.platform,
      itakVersion: expected.itakVersion,
      atakVersion: expected.atakVersion,
      serverVersion: expected.serverVersion,
    },
    evidenceBundleSha256: documentDigest(bundle),
    evidencePolicy: {
      maximumAgeDays: 30,
      allowedClockSkewSeconds: 300,
      readinessMustFollowPhysicalValidation: true,
      resultTimesMustFallWithinSessions: true,
      serverLogTimesMustFallWithinInteroperabilitySessions: true,
      privacyContractsRequired: true,
      maximumBundleBytes: maximumEvidenceBundleBytes,
      maximumReferenceCharacters: 240,
    },
    coverage: {
      physicalPlatforms: [...new Set(
        physical.map((entry) => entry.device.platform),
      )].sort(),
      supportedDepthPlatforms: [...new Set(
        physical.filter((entry) => entry.supportedDepth)
          .map((entry) => entry.device.platform),
      )].sort(),
      unsupportedDepthDevices: physical.filter(
        (entry) => !entry.supportedDepth,
      ).length,
      peerClients: [...new Set(
        interoperability.map((entry) => entry.session.peer.client),
      )].sort(),
      interoperabilityPlatforms: [...new Set(
        interoperability.map((entry) => entry.fieldPlatform),
      )].sort(),
    },
    evidence: {
      readinessReportDigests: [...usedReadiness].filter(Boolean).sort(),
      physicalSessionDigests: physical.map((entry) => entry.digest).sort(),
      interoperabilitySessionDigests: interoperability
        .map((entry) => entry.digest)
        .sort(),
    },
    verdict: 'pass',
  }
  return manifest
}

function argumentsMap(values) {
  const result = new Map()
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]
    const value = values[index + 1]
    requireValue(name?.startsWith('--') && value, `Invalid argument near ${name ?? 'end'}.`)
    result.set(name.slice(2), value)
  }
  return result
}

function option(options, name) {
  return string(options.get(name), `--${name}`)
}

async function collectCommand(options) {
  const inputDirectory = option(options, 'input-dir')
  const entries = (await readdir(inputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name) === '.json')
    .sort((left, right) => left.name.localeCompare(right.name))
  requireValue(entries.length > 0, 'The evidence directory contains no JSON files.')
  const documents = await Promise.all(entries.map(async (entry) => ({
    fileName: entry.name,
    document: JSON.parse(await readFile(join(inputDirectory, entry.name), 'utf8')),
  })))
  const bundle = collectReleaseEvidence({
    versionName: option(options, 'version'),
    buildNumber: option(options, 'build'),
    sourceRevision: option(options, 'revision'),
    documents,
  })
  await writePrivate(
    option(options, 'output'),
    `${JSON.stringify(bundle, null, 2)}\n`,
  )
}

async function verifyCommand(options) {
  const bundlePath = option(options, 'bundle')
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'))
  const manifest = verifyReleaseEvidence(bundle, {
    versionName: option(options, 'version'),
    buildNumber: option(options, 'build'),
    sourceRevision: option(options, 'revision'),
    platform: option(options, 'platform'),
    itakVersion: option(options, 'itak-version'),
    atakVersion: option(options, 'atak-version'),
    serverVersion: option(options, 'server-version'),
  })
  await writePrivate(
    option(options, 'manifest-out'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

async function encodeCommand(options) {
  const bundlePath = option(options, 'bundle')
  const contents = await readFile(bundlePath)
  const encoded = gzipSync(contents, { level: 9 }).toString('base64')
  requireValue(
    Buffer.byteLength(encoded) <= 48 * 1024,
    'Compressed evidence exceeds the GitHub environment-secret size limit.',
  )
  await writePrivate(option(options, 'output'), `${encoded}\n`)
}

async function decodeCommand(options) {
  const archive = await readFile(option(options, 'input'))
  requireValue(
    archive.length <= 48 * 1024,
    'Compressed evidence archive exceeds the accepted size limit.',
  )
  let contents
  try {
    contents = gunzipSync(archive, {
      maxOutputLength: maximumEvidenceBundleBytes,
    })
  } catch {
    fail('Evidence archive is invalid or expands beyond 1 MiB.')
  }
  try {
    JSON.parse(contents)
  } catch {
    fail('Decoded evidence bundle is not valid JSON.')
  }
  await writePrivate(option(options, 'output'), contents)
}

async function main() {
  const [command, ...values] = process.argv.slice(2)
  const options = argumentsMap(values)
  if (command === 'collect') return collectCommand(options)
  if (command === 'verify') return verifyCommand(options)
  if (command === 'encode') return encodeCommand(options)
  if (command === 'decode') return decodeCommand(options)
  fail(
    `Usage: ${basename(process.argv[1])} collect|verify|encode|decode [options]`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
