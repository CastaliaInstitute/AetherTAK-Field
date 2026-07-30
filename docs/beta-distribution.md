# Beta distribution

The manual `Beta Distribution` GitHub Actions workflow builds signed release
artifacts and performs external uploads. It never runs for a push or pull
request. Every run requires:

1. a version such as `0.2.0`;
2. a new positive build number/version code;
3. the target platform;
4. the released iTAK version used for validation;
5. the released ATAK version used for validation;
6. the AetherTAK/TAK Server version used for validation; and
7. the exact confirmation value `BETA`.

Both store jobs use the protected `beta-distribution` GitHub environment.
Configure required reviewers on that environment before adding secrets so a
workflow dispatch alone cannot publish a build.

The authorization job also uses that environment and fails closed unless the
private `RELEASE_EVIDENCE_BUNDLE_BASE64` secret contains a complete, passing
evidence bundle for the exact version, build, source revision, and requested
platform. It requires:

- a matching Device readiness report for every physical validation session;
- passing physical iOS and/or Android validation for every requested platform;
- supported ARKit LiDAR or ARCore Depth validation on each requested platform;
- a physical unsupported-depth fallback session;
- clear field/TAK queues, enrollment, connection, background tracking, offline
  maps, and media integrity in the matching readiness reports; and
- a verified Guardian check-in or supervisor certificate role, recorded
  without exporting the certificate common name; and
- complete passing bidirectional sessions with current iTAK and ATAK, including
  mission packages and matching TAK Server log references, from every requested
  AetherTAK Field platform.

All readiness reports, physical sessions, result timestamps, interoperability
sessions, and server-log intervals must be no more than 30 days old and no more
than five minutes ahead of the verification clock. Result and server-log times
must fall inside their recorded session. A Device readiness report must be
generated after the matching physical-device session completes, so a stale
pre-exercise snapshot cannot authorize distribution.

The verifier also enforces each export's privacy declaration, bounded
device/session metadata, UUID session identifiers, unique readiness checks,
and bounded controlled-evidence references. Missing or false exclusion flags,
unexpected privacy fields, malformed identifiers, or oversized references
fail authorization.

The private bundle is decoded only into the Actions runner's temporary
directory and deleted after authorization. The workflow retains only a
non-sensitive digest attestation as an artifact. Each platform job downloads
that exact authorization artifact and creates a provenance statement before
any store upload. The statement binds the final AAB or IPA checksum to the
evidence-bundle digest, source revision, version/build, repository, and
workflow run.

Bundle decoding is dependency-free and capped at 1 MiB of decompressed JSON.
This limit is enforced before parsing, so a small compressed archive cannot
expand without bound on the authorization runner.

## Prepare private release evidence

Export the readiness report and Device validation session from every required
physical device. Add one exported iTAK session and one exported ATAK session
for each released-client/device combination used by the candidate. Place only
these JSON exports in a temporary local directory.

Build, verify, and encode the bundle from the exact commit that will be
distributed:

```bash
node scripts/release-evidence.mjs collect \
  --input-dir /controlled/aethertak-field-0.2.0 \
  --version 0.2.0 \
  --build 42 \
  --revision "$(git rev-parse HEAD)" \
  --output /tmp/aethertak-field-evidence.json

node scripts/release-evidence.mjs verify \
  --bundle /tmp/aethertak-field-evidence.json \
  --version 0.2.0 \
  --build 42 \
  --revision "$(git rev-parse HEAD)" \
  --platform both \
  --itak-version 2.9 \
  --atak-version 5.5 \
  --server-version "AetherTAK 1.0" \
  --manifest-out /tmp/aethertak-field-attestation.json

node scripts/release-evidence.mjs encode \
  --bundle /tmp/aethertak-field-evidence.json \
  --output /tmp/aethertak-field-evidence.base64

gh secret set RELEASE_EVIDENCE_BUNDLE_BASE64 \
  --env beta-distribution \
  < /tmp/aethertak-field-evidence.base64
```

The encoder rejects content above GitHub's environment-secret size limit.
Never commit the raw bundle, encoded bundle, readiness reports, or physical
session exports. After the distribution run finishes, remove the per-candidate
secret and temporary files:

```bash
gh secret delete RELEASE_EVIDENCE_BUNDLE_BASE64 --env beta-distribution
rm -f \
  /tmp/aethertak-field-evidence.json \
  /tmp/aethertak-field-evidence.base64 \
  /tmp/aethertak-field-attestation.json
```

## Android and Google Play

Create the app
`org.castaliainstitute.aethertak.field` in Google Play Console and complete the
first-app setup required by Google. Grant a dedicated service account access to
this app only, with permission to manage testing-track releases.

Environment secrets:

- `RELEASE_EVIDENCE_BUNDLE_BASE64`: candidate-specific private evidence
  bundle, prepared above.
- `ANDROID_KEYSTORE_BASE64`: base64 of the release JKS/keystore.
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: the complete dedicated service-account
  JSON key.

The workflow injects the requested version into Gradle, runs the shared and
Android tests, builds a signed `.aab`, retains it with its checksum and
provenance statement, and uses the Android Publisher API edit transaction to
upload it to the `internal` track. The publisher rejects and abandons the edit
if Google Play reports a version code other than the requested build number.
It commits with `ERROR_IF_IN_REVIEW`, so it will not cancel an existing Google
Play review. Failed edits are deleted best-effort.

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

- `RELEASE_EVIDENCE_BUNDLE_BASE64`: candidate-specific private evidence
  bundle, prepared above.
- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`: base64 of the one-time `.p8`
  download.
- `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`: base64 of the distribution `.p12`.
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`

The macOS job creates an isolated temporary keychain, builds and exports a
signed IPA, verifies its bundle identifier, version, build number, signature,
and signing-team identifier, then creates its provenance statement. It
validates the IPA with App Store Connect, uploads it for TestFlight processing,
retains the IPA, checksum, and provenance statement as workflow artifacts, and
deletes the temporary keychain even after failure.

Apple processes an uploaded build asynchronously. After the first successful
upload, finish export-compliance metadata and assign the processed build to the
intended internal or external TestFlight group in App Store Connect. External
testing may require Beta App Review.

## Release evidence

For each beta, retain:

- the Git commit and successful workflow URL;
- store version and build number;
- generated AAB/IPA artifact checksums;
- the release-evidence attestation JSON and checksum artifact;
- each platform artifact's provenance JSON binding those two records;
- Google Play/TestFlight processing result and tester group;
- the in-app Device readiness JSON from every physical test device; and
- one completed Device validation session JSON from every release-candidate
  physical device, with its controlled screenshot/video/log evidence set;
- one exported iTAK/ATAK interoperability-session JSON per peer device and
  released-client version, with controlled screenshot and server-log
  references;
- physical-device smoke-test evidence for enrollment, TAK transport, offline
  recovery, background PLI, camera/video, and supported depth hardware.

Store upload success proves delivery to the store, not physical-device
correctness. Do not promote a beta until the physical evidence matrix in
`docs/physical-release-validation.md` and the bidirectional matrix in
`docs/tak-interoperability.md` are complete for the release candidate.
