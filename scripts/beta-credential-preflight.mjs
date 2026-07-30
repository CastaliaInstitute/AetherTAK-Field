#!/usr/bin/env node

import { createPrivateKey } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const appleIdentifierPattern = /^[A-Z0-9]{10}$/

function required(value, label, maximum = 4096) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw new Error(`${label} is missing or invalid.`)
  }
  return value
}

function decodeBase64(value, label, maximumBytes) {
  const encoded = required(value, label, maximumBytes * 2)
  if (
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error(`${label} is not canonical base64.`)
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (
    decoded.length === 0 ||
    decoded.length > maximumBytes ||
    decoded.toString('base64') !== encoded
  ) {
    throw new Error(`${label} is not canonical base64.`)
  }
  return decoded
}

function parsePrivateKey(pem, label, expectedType, expectedCurve = null) {
  let key
  try {
    key = createPrivateKey(pem)
  } catch {
    throw new Error(`${label} does not contain a valid private key.`)
  }
  if (key.asymmetricKeyType !== expectedType) {
    throw new Error(`${label} uses an unexpected key algorithm.`)
  }
  if (
    expectedCurve &&
    key.asymmetricKeyDetails?.namedCurve !== expectedCurve
  ) {
    throw new Error(`${label} uses an unexpected elliptic curve.`)
  }
  return key
}

function validatePkcs12Envelope(bytes, label) {
  if (bytes.length < 32 || bytes[0] !== 0x30) {
    throw new Error(`${label} is not a PKCS#12 DER envelope.`)
  }
}

export function validateAppleCredentials(environment) {
  const teamId = required(environment.APPLE_TEAM_ID, 'APPLE_TEAM_ID', 10)
  const keyId = required(
    environment.APP_STORE_CONNECT_KEY_ID,
    'APP_STORE_CONNECT_KEY_ID',
    10,
  )
  const issuerId = required(
    environment.APP_STORE_CONNECT_ISSUER_ID,
    'APP_STORE_CONNECT_ISSUER_ID',
    36,
  )
  if (!appleIdentifierPattern.test(teamId)) {
    throw new Error('APPLE_TEAM_ID must be a 10-character Apple team ID.')
  }
  if (!appleIdentifierPattern.test(keyId)) {
    throw new Error(
      'APP_STORE_CONNECT_KEY_ID must be a 10-character Apple key ID.',
    )
  }
  if (!uuidPattern.test(issuerId)) {
    throw new Error('APP_STORE_CONNECT_ISSUER_ID must be a UUID.')
  }

  const apiKey = decodeBase64(
    environment.APP_STORE_CONNECT_PRIVATE_KEY_BASE64,
    'APP_STORE_CONNECT_PRIVATE_KEY_BASE64',
    64 * 1024,
  )
  parsePrivateKey(
    apiKey.toString('utf8'),
    'APP_STORE_CONNECT_PRIVATE_KEY_BASE64',
    'ec',
    'prime256v1',
  )

  const certificate = decodeBase64(
    environment.APPLE_DISTRIBUTION_CERTIFICATE_BASE64,
    'APPLE_DISTRIBUTION_CERTIFICATE_BASE64',
    2 * 1024 * 1024,
  )
  validatePkcs12Envelope(
    certificate,
    'APPLE_DISTRIBUTION_CERTIFICATE_BASE64',
  )
  required(
    environment.APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD,
    'APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD',
    1024,
  )

  return {
    platform: 'ios',
    teamIdLength: teamId.length,
    keyIdLength: keyId.length,
    apiKeyAlgorithm: 'ec-prime256v1',
    certificateBytes: certificate.length,
  }
}

function validateKeystoreEnvelope(bytes) {
  const jks =
    bytes.length >= 4 &&
    bytes[0] === 0xfe &&
    bytes[1] === 0xed &&
    bytes[2] === 0xfe &&
    bytes[3] === 0xed
  const pkcs12 = bytes.length >= 32 && bytes[0] === 0x30
  if (!jks && !pkcs12) {
    throw new Error(
      'ANDROID_KEYSTORE_BASE64 is neither a JKS nor PKCS#12 envelope.',
    )
  }
  return jks ? 'jks' : 'pkcs12'
}

function parseServiceAccount(value) {
  let account
  try {
    account = JSON.parse(required(
      value,
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      128 * 1024,
    ))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is invalid JSON.')
    }
    throw error
  }
  if (
    typeof account !== 'object' ||
    account === null ||
    Array.isArray(account) ||
    account.type !== 'service_account' ||
    typeof account.project_id !== 'string' ||
    account.project_id.length === 0 ||
    typeof account.private_key_id !== 'string' ||
    account.private_key_id.length === 0 ||
    typeof account.client_email !== 'string' ||
    !account.client_email.endsWith('.gserviceaccount.com') ||
    account.token_uri !== 'https://oauth2.googleapis.com/token'
  ) {
    throw new Error(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not a bounded Google service account.',
    )
  }
  parsePrivateKey(
    account.private_key,
    'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON private_key',
    'rsa',
  )
  return account
}

export function validateAndroidCredentials(environment) {
  const keystore = decodeBase64(
    environment.ANDROID_KEYSTORE_BASE64,
    'ANDROID_KEYSTORE_BASE64',
    10 * 1024 * 1024,
  )
  const keystoreType = validateKeystoreEnvelope(keystore)
  required(
    environment.AETHER_ANDROID_KEYSTORE_PASSWORD,
    'AETHER_ANDROID_KEYSTORE_PASSWORD',
    1024,
  )
  required(
    environment.AETHER_ANDROID_KEY_ALIAS,
    'AETHER_ANDROID_KEY_ALIAS',
    256,
  )
  required(
    environment.AETHER_ANDROID_KEY_PASSWORD,
    'AETHER_ANDROID_KEY_PASSWORD',
    1024,
  )
  const account = parseServiceAccount(
    environment.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
  )
  return {
    platform: 'android',
    keystoreType,
    keystoreBytes: keystore.length,
    serviceAccountProjectConfigured: Boolean(account.project_id),
  }
}

function run() {
  const platform = process.argv[2]
  const result =
    platform === 'ios'
      ? validateAppleCredentials(process.env)
      : platform === 'android'
        ? validateAndroidCredentials(process.env)
        : null
  if (!result) {
    throw new Error(
      'Usage: node scripts/beta-credential-preflight.mjs <ios|android>',
    )
  }
  process.stdout.write(
    `Beta credential preflight passed for ${result.platform}.\n`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    run()
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Credential preflight failed.'}\n`,
    )
    process.exitCode = 1
  }
}
