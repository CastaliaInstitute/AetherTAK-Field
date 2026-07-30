import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parseServiceAccount,
  publishBundle,
  serviceAccountAssertion,
} from './google-play-publisher.mjs'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2_048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const account = {
  type: 'service_account',
  client_email: 'publisher@example.iam.gserviceaccount.com',
  private_key_id: 'test-key-id',
  private_key: privateKey,
  token_uri: 'https://oauth2.googleapis.com/token',
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('creates a short-lived scoped service-account assertion', () => {
  const token = serviceAccountAssertion(account, 1_800_000)
  const [header, claims, signature] = token.split('.')
  assert.deepEqual(
    JSON.parse(Buffer.from(header, 'base64url').toString()),
    { alg: 'RS256', typ: 'JWT', kid: account.private_key_id },
  )
  assert.deepEqual(
    JSON.parse(Buffer.from(claims, 'base64url').toString()),
    {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: account.token_uri,
      iat: 1_800,
      exp: 5_400,
    },
  )
  assert.ok(signature.length > 100)
})

test('publishes one bundle through an atomic Google Play edit', async () => {
  const requests = []
  const responses = [
    json({ access_token: 'test-token' }),
    json({ id: 'edit-7' }),
    json({ versionCode: 42 }),
    json({ track: 'internal' }),
    json({ id: 'edit-7' }),
  ]
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    return responses.shift()
  }

  const result = await publishBundle({
    serviceAccountJson: JSON.stringify(account),
    packageName: 'org.castaliainstitute.aethertak.field',
    releaseName: 'AetherTAK Field 0.2.0',
    expectedVersionCode: '42',
    bundle: Buffer.from('signed-aab'),
    fetchImpl,
  })

  assert.deepEqual(result, {
    editId: 'edit-7',
    track: 'internal',
    versionCode: '42',
  })
  assert.equal(requests.length, 5)
  assert.equal(requests[1].options.method, 'POST')
  assert.match(requests[2].url, /bundles\?uploadType=media$/)
  assert.equal(requests[2].options.body.toString(), 'signed-aab')
  assert.equal(requests[3].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[3].options.body), {
    track: 'internal',
    releases: [{
      name: 'AetherTAK Field 0.2.0',
      versionCodes: ['42'],
      status: 'completed',
    }],
  })
  assert.match(
    requests[4].url,
    /:commit\?changesInReviewBehavior=ERROR_IF_IN_REVIEW$/,
  )
})

test('deletes an uncommitted edit after a track failure', async () => {
  const requests = []
  const responses = [
    json({ access_token: 'test-token' }),
    json({ id: 'edit-failed' }),
    json({ versionCode: 43 }),
    json({ error: { message: 'track rejected' } }, 400),
    new Response(null, { status: 204 }),
  ]
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    return responses.shift()
  }

  await assert.rejects(
    publishBundle({
      serviceAccountJson: JSON.stringify(account),
      packageName: 'org.castaliainstitute.aethertak.field',
      expectedVersionCode: '43',
      bundle: Buffer.from('signed-aab'),
      fetchImpl,
    }),
    /track rejected/,
  )
  assert.equal(requests.at(-1).options.method, 'DELETE')
  assert.match(requests.at(-1).url, /edits\/edit-failed$/)
})

test('abandons the edit when Google Play reports a different version code', async () => {
  const requests = []
  const responses = [
    json({ access_token: 'test-token' }),
    json({ id: 'edit-mismatch' }),
    json({ versionCode: 44 }),
    new Response(null, { status: 204 }),
  ]
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    return responses.shift()
  }

  await assert.rejects(
    publishBundle({
      serviceAccountJson: JSON.stringify(account),
      packageName: 'org.castaliainstitute.aethertak.field',
      expectedVersionCode: '43',
      bundle: Buffer.from('signed-aab'),
      fetchImpl,
    }),
    /version code 44, expected 43/,
  )
  assert.equal(requests.at(-1).options.method, 'DELETE')
  assert.equal(requests.some(({ url }) => url.includes('/tracks/')), false)
})

test('rejects malformed service-account material before network access', () => {
  assert.throws(
    () => parseServiceAccount('{"type":"authorized_user"}'),
    /service-account key/,
  )
})

test('keeps beta distribution manual, protected, and internal-only', async () => {
  const [workflow, publisher] = await Promise.all([
    readFile(
      new URL('../.github/workflows/beta-distribution.yml', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('./google-play-publisher.mjs', import.meta.url),
      'utf8',
    ),
  ])
  assert.match(workflow, /^\s{2}workflow_dispatch:/m)
  assert.doesNotMatch(workflow, /^\s{2}(push|pull_request|schedule):/m)
  assert.match(workflow, /environment: beta-distribution/g)
  assert.match(workflow, /test "\$CONFIRM" = "BETA"/)
  assert.match(workflow, /secrets\.RELEASE_EVIDENCE_BUNDLE_BASE64/)
  assert.match(workflow, /scripts\/release-evidence\.mjs verify/)
  assert.match(workflow, /scripts\/release-evidence\.mjs decode/)
  assert.doesNotMatch(workflow, /gzip --decompress/)
  assert.match(workflow, /aethertak-field-release-attestation/)
  assert.match(workflow, /Remove private release evidence/)
  assert.match(workflow, /AETHER_GOOGLE_PLAY_TRACK: internal/)
  assert.match(publisher, /changesInReviewBehavior=ERROR_IF_IN_REVIEW/)
  assert.doesNotMatch(workflow, /AETHER_GOOGLE_PLAY_TRACK: production/)
})

test('requires injected versions and signing material for release builds', async () => {
  const [gradle, exportOptions] = await Promise.all([
    readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8'),
    readFile(
      new URL('../ios/ExportOptions-Beta.plist', import.meta.url),
      'utf8',
    ),
  ])
  for (const variable of [
    'AETHER_VERSION_CODE',
    'AETHER_VERSION_NAME',
    'AETHER_ANDROID_KEYSTORE_PATH',
    'AETHER_ANDROID_KEYSTORE_PASSWORD',
    'AETHER_ANDROID_KEY_ALIAS',
    'AETHER_ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(gradle, new RegExp(variable))
  }
  assert.match(exportOptions, /<string>app-store-connect<\/string>/)
  assert.match(exportOptions, /<string>CASTALIA_TEAM_ID<\/string>/)
  assert.match(exportOptions, /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/)
})
