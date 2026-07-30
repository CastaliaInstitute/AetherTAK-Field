import assert from 'node:assert/strict'
import {
  generateKeyPairSync,
} from 'node:crypto'
import { test } from 'node:test'
import {
  validateAndroidCredentials,
  validateAppleCredentials,
} from './beta-credential-preflight.mjs'

function appleEnvironment() {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })
  const certificate = Buffer.alloc(64)
  certificate[0] = 0x30
  return {
    APPLE_TEAM_ID: 'A1B2C3D4E5',
    APP_STORE_CONNECT_KEY_ID: 'F6G7H8J9K0',
    APP_STORE_CONNECT_ISSUER_ID: '82e41b07-9ada-4f64-b5b5-42f1aebba217',
    APP_STORE_CONNECT_PRIVATE_KEY_BASE64: Buffer.from(
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ).toString('base64'),
    APPLE_DISTRIBUTION_CERTIFICATE_BASE64:
      certificate.toString('base64'),
    APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD: 'test-only',
  }
}

function androidEnvironment() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const keystore = Buffer.alloc(64)
  keystore.set([0xfe, 0xed, 0xfe, 0xed])
  return {
    ANDROID_KEYSTORE_BASE64: keystore.toString('base64'),
    AETHER_ANDROID_KEYSTORE_PASSWORD: 'test-only',
    AETHER_ANDROID_KEY_ALIAS: 'release',
    AETHER_ANDROID_KEY_PASSWORD: 'test-only',
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: 'service_account',
      project_id: 'castalia-test',
      private_key_id: 'test-key-id',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      client_email:
        'aethertak-field-publisher@castalia-test.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
  }
}

test('validates Apple identifiers, API key, and PKCS#12 envelope', () => {
  assert.deepEqual(
    validateAppleCredentials(appleEnvironment()),
    {
      platform: 'ios',
      teamIdLength: 10,
      keyIdLength: 10,
      apiKeyAlgorithm: 'ec-prime256v1',
      certificateBytes: 64,
    },
  )
})

test('rejects malformed or wrong-algorithm Apple credentials', () => {
  assert.throws(
    () => validateAppleCredentials({
      ...appleEnvironment(),
      APP_STORE_CONNECT_ISSUER_ID: 'not-a-uuid',
    }),
    /must be a UUID/,
  )
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  assert.throws(
    () => validateAppleCredentials({
      ...appleEnvironment(),
      APP_STORE_CONNECT_PRIVATE_KEY_BASE64: Buffer.from(
        privateKey.export({ type: 'pkcs8', format: 'pem' }),
      ).toString('base64'),
    }),
    /unexpected key algorithm/,
  )
})

test('validates Android keystore and bounded service account material', () => {
  assert.deepEqual(
    validateAndroidCredentials(androidEnvironment()),
    {
      platform: 'android',
      keystoreType: 'jks',
      keystoreBytes: 64,
      serviceAccountProjectConfigured: true,
    },
  )
})

test('rejects malformed Android keystores and service-account endpoints', () => {
  assert.throws(
    () => validateAndroidCredentials({
      ...androidEnvironment(),
      ANDROID_KEYSTORE_BASE64: Buffer.alloc(64).toString('base64'),
    }),
    /neither a JKS nor PKCS#12/,
  )
  const environment = androidEnvironment()
  const account = JSON.parse(environment.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)
  account.token_uri = 'https://attacker.invalid/token'
  assert.throws(
    () => validateAndroidCredentials({
      ...environment,
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(account),
    }),
    /not a bounded Google service account/,
  )
})
