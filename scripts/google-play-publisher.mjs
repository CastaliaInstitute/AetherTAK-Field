import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const androidPublisherScope =
  'https://www.googleapis.com/auth/androidpublisher'
const publisherRoot =
  'https://androidpublisher.googleapis.com/androidpublisher/v3'
const publisherUploadRoot =
  'https://androidpublisher.googleapis.com/upload/androidpublisher/v3'

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export function parseServiceAccount(value) {
  let account
  try {
    account = JSON.parse(value)
  } catch {
    throw new Error('Google Play service-account JSON is invalid.')
  }
  if (
    account?.type !== 'service_account' ||
    typeof account.client_email !== 'string' ||
    typeof account.private_key_id !== 'string' ||
    typeof account.private_key !== 'string' ||
    ![
      'https://oauth2.googleapis.com/token',
      'https://accounts.google.com/o/oauth2/token',
    ].includes(account.token_uri)
  ) {
    throw new Error(
      'Google Play credentials must be a service-account key with client_email, private_key_id, private_key, and an official Google token URI.',
    )
  }
  return account
}

export function serviceAccountAssertion(account, now = Date.now()) {
  const issuedAt = Math.floor(now / 1_000)
  const header = base64url(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
    kid: account.private_key_id,
  }))
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: androidPublisherScope,
    aud: account.token_uri,
    iat: issuedAt,
    exp: issuedAt + 3_600,
  }))
  const unsigned = `${header}.${claims}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  return `${unsigned}.${base64url(signer.sign(account.private_key))}`
}

async function responseJson(response, operation) {
  const text = await response.text()
  if (!response.ok) {
    const detail = text.slice(0, 2_000) || `${response.status} ${response.statusText}`
    throw new Error(`${operation} failed: ${detail}`)
  }
  return text ? JSON.parse(text) : {}
}

async function accessToken(account, fetchImpl) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: serviceAccountAssertion(account),
  })
  const response = await fetchImpl(account.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const result = await responseJson(response, 'Google OAuth authentication')
  if (typeof result.access_token !== 'string' || !result.access_token) {
    throw new Error('Google OAuth did not return an access token.')
  }
  return result.access_token
}

export async function publishBundle({
  serviceAccountJson,
  packageName,
  track = 'internal',
  releaseName,
  expectedVersionCode,
  bundle,
  fetchImpl = fetch,
}) {
  if (!/^[A-Za-z][A-Za-z0-9_.]+$/.test(packageName)) {
    throw new Error('A valid Android package name is required.')
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(track)) {
    throw new Error('A valid Google Play track is required.')
  }
  if (!Buffer.isBuffer(bundle) || bundle.length === 0) {
    throw new Error('The Android App Bundle is empty.')
  }
  if (!/^[1-9][0-9]*$/.test(expectedVersionCode)) {
    throw new Error('The expected Google Play version code is required.')
  }

  const account = parseServiceAccount(serviceAccountJson)
  const token = await accessToken(account, fetchImpl)
  const headers = { authorization: `Bearer ${token}` }
  const application = encodeURIComponent(packageName)
  let editId
  let committed = false

  try {
    const editResponse = await fetchImpl(
      `${publisherRoot}/applications/${application}/edits`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}',
      },
    )
    const edit = await responseJson(editResponse, 'Create Google Play edit')
    if (typeof edit.id !== 'string' || !edit.id) {
      throw new Error('Google Play did not return an edit identifier.')
    }
    editId = encodeURIComponent(edit.id)

    const uploadResponse = await fetchImpl(
      `${publisherUploadRoot}/applications/${application}/edits/${editId}/bundles?uploadType=media`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/octet-stream',
          'content-length': String(bundle.length),
        },
        body: bundle,
      },
    )
    const uploaded = await responseJson(
      uploadResponse,
      'Upload Android App Bundle',
    )
    if (!Number.isInteger(uploaded.versionCode) || uploaded.versionCode <= 0) {
      throw new Error('Google Play did not return an uploaded version code.')
    }
    const versionCode = String(uploaded.versionCode)
    if (versionCode !== expectedVersionCode) {
      throw new Error(
        `Google Play uploaded version code ${versionCode}, expected ${expectedVersionCode}.`,
      )
    }

    const trackResponse = await fetchImpl(
      `${publisherRoot}/applications/${application}/edits/${editId}/tracks/${encodeURIComponent(track)}`,
      {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          track,
          releases: [{
            name: releaseName || `AetherTAK Field ${versionCode}`,
            versionCodes: [versionCode],
            status: 'completed',
          }],
        }),
      },
    )
    await responseJson(trackResponse, 'Update Google Play testing track')

    const commitResponse = await fetchImpl(
      `${publisherRoot}/applications/${application}/edits/${editId}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`,
      { method: 'POST', headers },
    )
    await responseJson(commitResponse, 'Commit Google Play edit')
    committed = true
    return { editId: decodeURIComponent(editId), track, versionCode }
  } finally {
    if (editId && !committed) {
      await fetchImpl(
        `${publisherRoot}/applications/${application}/edits/${editId}`,
        { method: 'DELETE', headers },
      ).catch(() => undefined)
    }
  }
}

async function main() {
  const [
    serviceAccountJson,
    packageName,
    bundlePath,
    track = 'internal',
    releaseName,
    expectedVersionCode,
  ] = [
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
    process.env.AETHER_ANDROID_PACKAGE_NAME,
    process.env.AETHER_ANDROID_BUNDLE_PATH,
    process.env.AETHER_GOOGLE_PLAY_TRACK,
    process.env.AETHER_RELEASE_NAME,
    process.env.AETHER_VERSION_CODE,
  ]
  if (!serviceAccountJson || !packageName || !bundlePath || !expectedVersionCode) {
    throw new Error(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, AETHER_ANDROID_PACKAGE_NAME, AETHER_ANDROID_BUNDLE_PATH, and AETHER_VERSION_CODE are required.',
    )
  }
  const result = await publishBundle({
    serviceAccountJson,
    packageName,
    track,
    releaseName,
    expectedVersionCode,
    bundle: await readFile(bundlePath),
  })
  process.stdout.write(
    `Published version ${result.versionCode} to Google Play ${result.track}.\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  })
}
