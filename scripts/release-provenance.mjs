import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

export async function createReleaseProvenance({
  attestationPath,
  artifactPath,
  versionName,
  buildNumber,
  sourceRevision,
  platform,
  repository,
  runId,
  runAttempt,
  createdAt = new Date(),
}) {
  requireValue(platform === 'android' || platform === 'ios', 'Platform must be android or ios.')
  const [attestationContents, artifactContents] = await Promise.all([
    readFile(attestationPath),
    readFile(artifactPath),
  ])
  requireValue(artifactContents.length > 0, 'Release artifact is empty.')

  let attestation
  try {
    attestation = JSON.parse(attestationContents)
  } catch {
    throw new Error('Release attestation is not valid JSON.')
  }
  requireValue(
    attestation?.schemaVersion === 1 && attestation?.verdict === 'pass',
    'Release attestation is not a passing schema version 1 attestation.',
  )
  const release = attestation.release
  requireValue(release?.versionName === versionName, 'Attestation version does not match.')
  requireValue(String(release?.buildNumber) === buildNumber, 'Attestation build does not match.')
  requireValue(release?.sourceRevision === sourceRevision, 'Attestation revision does not match.')
  requireValue(
    release?.platform === 'both' || release?.platform === platform,
    `Attestation does not authorize ${platform}.`,
  )
  requireValue(/^[0-9a-f]{64}$/.test(attestation.evidenceBundleSha256), 'Attestation evidence digest is invalid.')
  requireValue(/^[0-9a-f]{40,64}$/.test(sourceRevision), 'Source revision must be a full Git revision.')
  requireValue(typeof repository === 'string' && repository.length > 0, 'Repository is required.')
  requireValue(/^[1-9][0-9]*$/.test(runId), 'Workflow run ID is invalid.')
  requireValue(/^[1-9][0-9]*$/.test(runAttempt), 'Workflow run attempt is invalid.')

  return {
    schemaVersion: 1,
    createdAt: createdAt.toISOString(),
    subject: {
      name: basename(artifactPath),
      sha256: sha256(artifactContents),
      sizeBytes: artifactContents.length,
      platform,
    },
    release: {
      versionName,
      buildNumber,
      sourceRevision,
    },
    evidence: {
      attestationSha256: sha256(attestationContents),
      evidenceBundleSha256: attestation.evidenceBundleSha256,
    },
    workflow: {
      repository,
      runId,
      runAttempt,
    },
  }
}

function argumentsMap(values) {
  const options = new Map()
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]
    const value = values[index + 1]
    requireValue(name?.startsWith('--') && value, `Invalid argument near ${name ?? 'end'}.`)
    options.set(name.slice(2), value)
  }
  return options
}

function option(options, name) {
  const value = options.get(name)
  requireValue(typeof value === 'string' && value.length > 0, `--${name} is required.`)
  return value
}

async function main() {
  const options = argumentsMap(process.argv.slice(2))
  const provenance = await createReleaseProvenance({
    attestationPath: option(options, 'attestation'),
    artifactPath: option(options, 'artifact'),
    versionName: option(options, 'version'),
    buildNumber: option(options, 'build'),
    sourceRevision: option(options, 'revision'),
    platform: option(options, 'platform'),
    repository: option(options, 'repository'),
    runId: option(options, 'run-id'),
    runAttempt: option(options, 'run-attempt'),
  })
  await writeFile(
    option(options, 'output'),
    `${JSON.stringify(provenance, null, 2)}\n`,
    { mode: 0o600 },
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
