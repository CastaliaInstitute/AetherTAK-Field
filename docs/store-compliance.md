# Store compliance

Run `npm run compliance` before producing any distribution build. The beta workflow runs the same gate before it accepts private physical-test evidence.

The automated gate verifies:

- the iOS privacy manifest is bundled and declares no tracking, current collected-data categories, and required-reason APIs;
- Android targets API 36 and requests only the expected camera, audio, foreground-location, and network permissions;
- Android does not request background location, broad storage, or broad media-library access;
- the checked-in App Store and Google Play answers cover the canonical privacy inventory; and
- store listing length limits are respected.

Manual submission work remains:

1. Approve and publish the privacy notice at a public URL.
2. Supply the privacy-policy URL and support URL in both consoles.
3. Reconcile the declarations with the production AetherTAK operator, processors, retention, and deletion process.
4. Capture current phone and tablet screenshots on the release candidate.
5. Complete age/content ratings, category, territories, export-compliance, accessibility, and reviewer instructions.
6. Re-run physical iTAK, ATAK, AetherTAK, offline, camera, audio, depth, and sensor validation for the exact release revision.

The checked-in privacy forms are operational guidance, not a substitute for App Store Connect, Play Console, or legal review.
