import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createReleaseProvenance } from './release-provenance.mjs'

const revision = '1234567890abcdef1234567890abcdef12345678'

async function fixture(platform = 'both') {
  const directory = await mkdtemp(join(tmpdir(), 'aethertak-provenance-'))
  const attestationPath = join(directory, 'attestation.json')
  const artifactPath = join(directory, 'app-release.aab')
  await writeFile(attestationPath, JSON.stringify({
    schemaVersion: 1,
    verdict: 'pass',
    release: {
      versionName: '0.2.0',
      buildNumber: '42',
      sourceRevision: revision,
      platform,
    },
    evidenceBundleSha256: 'a'.repeat(64),
  }))
  await writeFile(artifactPath, 'signed artifact')
  return { attestationPath, artifactPath }
}

async function create(overrides = {}) {
  return createReleaseProvenance({
    ...await fixture(),
    versionName: '0.2.0',
    buildNumber: '42',
    sourceRevision: revision,
    platform: 'android',
    repository: 'CastaliaInstitute/AetherTAK-Field',
    runId: '1234',
    runAttempt: '1',
    createdAt: new Date('2026-07-30T12:00:00.000Z'),
    ...overrides,
  })
}

test('binds one store artifact to exact evidence, source, and workflow run', async () => {
  const provenance = await create()
  assert.equal(provenance.subject.platform, 'android')
  assert.equal(provenance.subject.sizeBytes, 15)
  assert.match(provenance.subject.sha256, /^[0-9a-f]{64}$/)
  assert.match(provenance.evidence.attestationSha256, /^[0-9a-f]{64}$/)
  assert.equal(provenance.evidence.evidenceBundleSha256, 'a'.repeat(64))
  assert.equal(provenance.release.sourceRevision, revision)
  assert.deepEqual(provenance.workflow, {
    repository: 'CastaliaInstitute/AetherTAK-Field',
    runId: '1234',
    runAttempt: '1',
  })
})

test('fails closed for mismatched or non-passing evidence', async () => {
  await assert.rejects(create({ versionName: '0.2.1' }), /version/)

  const files = await fixture('ios')
  await assert.rejects(
    createReleaseProvenance({
      ...files,
      versionName: '0.2.0',
      buildNumber: '42',
      sourceRevision: revision,
      platform: 'android',
      repository: 'CastaliaInstitute/AetherTAK-Field',
      runId: '1',
      runAttempt: '1',
    }),
    /does not authorize android/,
  )

  const attestation = JSON.parse(await readFile(files.attestationPath, 'utf8'))
  attestation.verdict = 'fail'
  await writeFile(files.attestationPath, JSON.stringify(attestation))
  await assert.rejects(
    createReleaseProvenance({
      ...files,
      versionName: '0.2.0',
      buildNumber: '42',
      sourceRevision: revision,
      platform: 'ios',
      repository: 'CastaliaInstitute/AetherTAK-Field',
      runId: '1',
      runAttempt: '1',
    }),
    /not a passing/,
  )
})

test('store jobs consume the authorization attestation before uploads', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/beta-distribution.yml', import.meta.url),
    'utf8',
  )
  assert.equal((workflow.match(/actions\/download-artifact@v7/g) ?? []).length, 2)
  assert.equal((workflow.match(/scripts\/release-provenance\.mjs/g) ?? []).length, 2)
  assert.match(workflow, /Attest Android artifact[\s\S]*release-provenance\.mjs[\s\S]*Publish to Google Play/)
  assert.match(workflow, /Attest iOS artifact[\s\S]*release-provenance\.mjs[\s\S]*Upload to TestFlight/)
  assert.match(workflow, /Verify exported IPA identity[\s\S]*CFBundleShortVersionString[\s\S]*CFBundleVersion/)
})
