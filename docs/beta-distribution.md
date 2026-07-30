# Beta distribution

The manual `Beta Distribution` GitHub Actions workflow builds signed release
artifacts and performs external uploads. It never runs for a push or pull
request. Every run requires:

1. a version such as `0.2.0`;
2. a new positive build number/version code;
3. the target platform; and
4. the exact confirmation value `BETA`.

Both store jobs use the protected `beta-distribution` GitHub environment.
Configure required reviewers on that environment before adding secrets so a
workflow dispatch alone cannot publish a build.

## Android and Google Play

Create the app
`org.castaliainstitute.aethertak.field` in Google Play Console and complete the
first-app setup required by Google. Grant a dedicated service account access to
this app only, with permission to manage testing-track releases.

Environment secrets:

- `ANDROID_KEYSTORE_BASE64`: base64 of the release JKS/keystore.
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: the complete dedicated service-account
  JSON key.

The workflow injects the requested version into Gradle, runs the shared and
Android tests, builds a signed `.aab`, retains it as a workflow artifact, and
uses the Android Publisher API edit transaction to upload it to the `internal`
track. It commits with `ERROR_IF_IN_REVIEW`, so it will not cancel an existing
Google Play review. Failed edits are deleted best-effort.

Normal pull-request CI also builds a release AAB using a one-day, disposable
CI-only signing key. That proves the release Gradle path but the resulting AAB
is deliberately not retained or publishable.

Never reuse a Google Play version code. Rotate the service-account key and
Android signing material according to Castalia Institute policy; do not store
either in the repository.

## iOS and TestFlight

Create the App Store Connect record for bundle ID
`org.castaliainstitute.aethertak.field` before the first upload. Use a team App
Store Connect API key whose role permits automatic signing and build uploads.
Export the Apple Distribution identity and its certificate chain as a
password-protected PKCS#12 file.

Environment secrets:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`: base64 of the one-time `.p8`
  download.
- `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`: base64 of the distribution `.p12`.
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`

The macOS job creates an isolated temporary keychain, builds and exports a
signed IPA with the requested version/build, validates it with App Store
Connect, uploads it for TestFlight processing, retains the IPA as a workflow
artifact, and deletes the temporary keychain even after failure.

Apple processes an uploaded build asynchronously. After the first successful
upload, finish export-compliance metadata and assign the processed build to the
intended internal or external TestFlight group in App Store Connect. External
testing may require Beta App Review.

## Release evidence

For each beta, retain:

- the Git commit and successful workflow URL;
- store version and build number;
- generated AAB/IPA artifact checksums;
- Google Play/TestFlight processing result and tester group;
- the in-app Device readiness JSON from every physical test device; and
- one exported iTAK/ATAK interoperability-session JSON per peer device and
  released-client version, with controlled screenshot and server-log
  references;
- physical-device smoke-test evidence for enrollment, TAK transport, offline
  recovery, background PLI, camera/video, and supported depth hardware.

Store upload success proves delivery to the store, not physical-device
correctness. Do not promote a beta until the physical evidence matrix in
`docs/tak-interoperability.md` is complete for the release candidate.
