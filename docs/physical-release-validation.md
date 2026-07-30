# Physical release validation

Simulator and CI builds prove compilation and deterministic shared behavior.
They do not prove mobile permissions, suspension, secure credential storage,
camera hardware, depth accuracy, storage pressure, or radio/network recovery.
Run this gate on every physical device class intended for the beta.

## Start a device-bound session

1. Install the exact release-candidate build.
2. Open **Team → Device validation session**.
3. Enter a controlled evidence-set reference such as
   `RC-0.2.0/ios-lidar-01`. Do not enter a tester name, server address, or
   device identifier.
4. Complete each exercise and store screenshots, video, exported artifacts,
   and relevant sanitized logs in the controlled evidence set.
5. Record only the controlled reference and privacy-safe behavioral notes in
   the app.
6. Export the completed JSON beside that evidence set before deleting or
   replacing the local session.
7. Run and export **Device readiness after the session is complete**. The beta
   verifier rejects a readiness snapshot generated before the matching
   physical exercises.

The session captures the installed app version/build and source revision plus
the device model, OS, platform, and physical-versus-virtual state. A result is
not complete until it has a non-pending status and controlled evidence
reference. `Not applicable` requires a justification, normally including the
companion-device session that covers the capability.

Complete and verify a candidate within 30 days. Keep device clocks synchronized:
the distribution gate permits at most five minutes of clock skew and rejects
result timestamps outside the parent session.

## Required exercises

| Gate | Required observation |
| --- | --- |
| Certificate enrollment | Fresh package imports, expected callsign/team appear, the mTLS TAK connection succeeds, and Device readiness reports a passing certificate-authenticated Aether Field API health check. |
| Certificate renewal | Replacement succeeds, the new identity connects, and the retired identity is removed. |
| Offline capture and relaunch | Field records and evidence survive termination and relaunch without connectivity. |
| Ordered reconnect synchronization | Sequential offline edits converge in order after connectivity returns. |
| Conflict recovery | Explicit keep-device, use-server, deletion, and resurrection decisions preserve the intended record. |
| Geotagged photo | Structured metadata, location, local preview, digest, and synchronized artifact agree. |
| Geotagged video | Structured metadata, location, playback, digest, and synchronized artifact agree. |
| Media round trip | A removed local artifact hydrates again with matching type, byte count, and SHA-256. |
| Known-dimension depth accuracy | A controlled target is measured against a predeclared tolerance. |
| Depth artifact export | Preview, metric depth, supported confidence, point cloud, measurements, and supported model open correctly; every synchronized artifact retains its originating SHA-256. |
| Unsupported-depth fallback | Unsupported hardware reports capability honestly and provides a safe fallback without a crash. |
| Screen-lock tracking and task-switcher privacy | PLI continues at the expected cadence with the iOS indicator or Android foreground notification. The task switcher shows only the privacy shield or non-sensitive theme background for both the main app and depth capture, while an intentional foreground validation screenshot still works. |
| Permission revocation | Location/camera permission loss produces a safe, recoverable error. On Android, revoking notification visibility stops background PLI without leaving a stale sharing state. |
| Airplane-mode recovery | Queued work survives relaunch and resumes automatically after the network returns. |
| Low storage and map-cache eviction | Capture or map download fails within a bounded operation and remains recoverable. After WebView map-cache eviction, relaunch or foreground the app and confirm affected ready regions become partial/failed with an accurate count and Resume available. |

For known-dimension depth accuracy, enter the known distance, measured
distance, and accepted error percentage. The app derives absolute percentage
error and assigns pass/fail. Set the tolerance before testing and retain the
measurement screen plus exported depth artifacts.

## Device coverage

At minimum, retain sessions for:

- one supported iOS LiDAR device;
- one supported Android ARCore Depth device;
- one iOS or Android device without supported depth hardware;
- every additional OS/device class included in the beta when its camera,
  storage, background-execution, or depth behavior materially differs.

Run **Team → Device readiness** after the exercises and retain that state
snapshot with the session. Separately complete one bidirectional iTAK and ATAK
session per released peer version on every AetherTAK Field platform in the
candidate, as described in `docs/tak-interoperability.md`.

## Privacy and acceptance

The exported session excludes credentials, certificates, server addresses,
coordinates, record/message content, media/log bodies, and personal tester
identity. Controlled references must not embed those values.

A completed JSON means every exercise has an evidenced result; it does not mean
every result passed. A release candidate is acceptable only when required
results pass, justified device-specific exclusions are covered by companion
sessions, the device-readiness snapshot has no unexplained failure, and the
iTAK/ATAK matrix is complete. The in-app verdict rejects completed simulator,
browser, failed, or blocked sessions and keeps sessions with `Not applicable`
results at attention until companion-device evidence covers them.
