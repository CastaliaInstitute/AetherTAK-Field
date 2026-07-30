import { createHash } from 'node:crypto'
import {
  chmod,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

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
  'background-tracking',
  'field-sync',
  'tak-outbox',
  'offline-maps',
  'media-integrity',
]

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

function timestamp(value, label) {
  const parsed = Date.parse(string(value, label))
  requireValue(Number.isFinite(parsed), `${label} is not a valid timestamp.`)
  return parsed
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

function validateReadiness(reportValue, expected) {
  const report = object(reportValue, 'Device readiness report')
  requireValue(report.schemaVersion === 1, 'Unsupported readiness schema.')
  exactBuild(object(report.app, 'Readiness app'), expected, 'Readiness report')
  const device = object(report.device, 'Readiness device')
  requireValue(
    device.platform === 'ios' || device.platform === 'android',
    'Readiness report must come from iOS or Android.',
  )
  requireValue(device.isVirtual === false, 'Readiness report came from a virtual device.')
  const runtime = object(report.runtime, 'Readiness runtime')
  requireValue(runtime.native === true, 'Readiness report did not come from the native app.')
  const checks = new Map(
    array(report.checks, 'Readiness checks').map((checkValue) => {
      const check = object(checkValue, 'Readiness check')
      return [check.id, check]
    }),
  )
  for (const id of requiredReadinessChecks) {
    requireValue(
      checks.get(id)?.status === 'pass',
      `Readiness check ${id} did not pass on ${device.model}.`,
    )
  }
  const depth = object(report.depth, 'Readiness depth')
  if (depth.supported) {
    const expectedProvider = device.platform === 'ios' ? 'arkit' : 'arcore'
    requireValue(
      String(depth.provider).toLowerCase().includes(expectedProvider),
      `${device.platform} depth report does not identify ${expectedProvider}.`,
    )
    requireValue(depth.supportsPointCloud === true, 'Supported depth lacks point-cloud capability.')
  }
  return {
    report,
    device,
    depth,
    digest: documentDigest(report),
  }
}

function matchingReadiness(session, readiness) {
  return readiness.find(({ report, device }) =>
    device.platform === session.device.platform &&
    device.model === session.device.model &&
    device.operatingSystem === session.device.operatingSystem &&
    device.osVersion === session.device.osVersion &&
    report.app.version === session.release.appVersion &&
    String(report.app.build) === String(session.release.build) &&
    report.app.sourceRevision === session.release.sourceRevision,
  )
}

function completePhysicalResult(result, label) {
  requireValue(result.status !== 'pending', `${label} is still pending.`)
  timestamp(result.testedAt, `${label} test timestamp`)
  if (result.status === 'not_applicable') {
    requireValue(
      typeof result.notes === 'string' && result.notes.trim().length > 0,
      `${label} N/A has no justification.`,
    )
  } else {
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

function validatePhysicalSession(sessionValue, expected, readiness) {
  const session = object(sessionValue, 'Device validation session')
  requireValue(session.schemaVersion === 1, 'Unsupported device validation schema.')
  timestamp(session.completedAt, 'Device validation completion')
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
  const results = uniqueResults(
    session.results,
    physicalChecks,
    'check',
    `Device validation ${session.id}`,
  )
  for (const [id, result] of results) {
    completePhysicalResult(result, `${device.model} ${id}`)
  }
  const readinessMatch = matchingReadiness(session, readiness)
  requireValue(
    readinessMatch,
    `No matching Device readiness report for ${device.platform} ${device.model}.`,
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

function validateInteroperabilitySession(sessionValue, expected) {
  const session = object(sessionValue, 'Interoperability session')
  requireValue(session.schemaVersion === 1, 'Unsupported interoperability schema.')
  timestamp(session.completedAt, 'Interoperability completion')
  exactBuild(object(session.field, 'Interoperability field build'), expected, 'Interoperability session')
  requireValue(
    session.peer?.client === 'iTAK' || session.peer?.client === 'ATAK',
    'Interoperability peer must be iTAK or ATAK.',
  )
  string(session.peer.version, 'Peer version')
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
  const startsAt = timestamp(interval.startsAt, 'Server log start')
  const endsAt = timestamp(interval.endsAt, 'Server log end')
  requireValue(startsAt <= endsAt, 'Server log interval ends before it starts.')
  string(interval.reference, 'Controlled server log reference')
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
    timestamp(result.testedAt, `${pair} timestamp`)
    string(result.evidenceReference, `${pair} evidence reference`)
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
  const bundle = object(bundleValue, 'Release evidence bundle')
  requireValue(bundle.schemaVersion === 1, 'Unsupported release evidence bundle schema.')
  requireValue(bundle.versionName === expected.versionName, 'Evidence bundle version mismatch.')
  requireValue(String(bundle.buildNumber) === expected.buildNumber, 'Evidence bundle build mismatch.')
  requireValue(bundle.sourceRevision === expected.sourceRevision, 'Evidence bundle revision mismatch.')
  const platforms = requiredPlatforms(expected.platform)
  const readiness = array(bundle.readinessReports, 'Readiness reports').map(
    (report) => validateReadiness(report, expected),
  )
  const physical = array(bundle.physicalSessions, 'Device validation sessions').map(
    (session) => validatePhysicalSession(session, expected, readiness),
  )
  const interoperability = array(
    bundle.interoperabilitySessions,
    'Interoperability sessions',
  ).map((session) => validateInteroperabilitySession(session, expected))

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

async function main() {
  const [command, ...values] = process.argv.slice(2)
  const options = argumentsMap(values)
  if (command === 'collect') return collectCommand(options)
  if (command === 'verify') return verifyCommand(options)
  if (command === 'encode') return encodeCommand(options)
  fail(
    `Usage: ${basename(process.argv[1])} collect|verify|encode [options]`,
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
