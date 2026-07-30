import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStoreCompliance } from "./store-compliance.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("native privacy declarations and store answers remain aligned", async () => {
  const result = await verifyStoreCompliance(repositoryRoot);

  assert.equal(result.androidTargetSdk, 36);
  assert.equal(result.iosCollectedTypeCount, 8);
  assert.equal(result.dataTypeCount, 6);
  assert.ok(result.shortDescriptionLength <= 80);
});

test("normal CI exercises release artifact paths before beta distribution", async () => {
  const workflow = await fs.readFile(
    path.join(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );

  for (const required of [
    "npm run compliance",
    "bundleRelease",
    "apksigner",
    "base/assets/public/assets/*.js",
    "-configuration Release",
    "-sdk iphoneos",
    "Release-iphoneos/App.app",
    "PrivacyInfo.xcprivacy",
    "VITE_AETHER_SOURCE_REVISION",
  ]) {
    assert.match(
      workflow,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `Mobile CI must include ${required}`,
    );
  }
});

test("TAK bridge methods remain aligned across TypeScript Kotlin and Swift", async () => {
  const [typescript, kotlin, swift, androidClient, iosClient] = await Promise.all([
    fs.readFile(path.join(repositoryRoot, "src/platform/tak.ts"), "utf8"),
    fs.readFile(
      path.join(
        repositoryRoot,
        "android/app/src/main/java/org/castaliainstitute/aethertak/field/plugins/AetherTakTransportPlugin.kt",
      ),
      "utf8",
    ),
    fs.readFile(
      path.join(repositoryRoot, "ios/App/App/AetherTakTransportPlugin.swift"),
      "utf8",
    ),
    fs.readFile(
      path.join(
        repositoryRoot,
        "android/app/src/main/java/org/castaliainstitute/aethertak/field/tak/TakFieldApiClient.kt",
      ),
      "utf8",
    ),
    fs.readFile(
      path.join(repositoryRoot, "ios/App/App/TakFieldApiClient.swift"),
      "utf8",
    ),
  ]);
  const methods = [
    "importEnrollmentPackage",
    "connect",
    "disconnect",
    "removeEnrollment",
    "getStatus",
    "getBackgroundTrackingStatus",
    "setBackgroundTracking",
    "getContacts",
    "sendCot",
    "fieldHealth",
    "fieldMutation",
    "guardianAction",
    "fieldChanges",
    "fieldUpload",
    "fieldDownload",
    "missionPackageUpload",
    "missionPackageDownload",
  ];

  for (const method of methods) {
    assert.match(typescript, new RegExp(`\\b${method}\\s*\\(`));
    assert.match(kotlin, new RegExp(`fun\\s+${method}\\s*\\(`));
    assert.match(
      swift,
      new RegExp(`CAPPluginMethod\\(name:\\s*"${method}"`),
    );
    assert.match(swift, new RegExp(`@objc\\s+func\\s+${method}\\s*\\(`));
  }
  assert.match(androidClient, /path\s*=\s*"\/healthz"/);
  assert.match(iosClient, /path:\s*"\/healthz"/);
  for (const client of [androidClient, iosClient]) {
    assert.match(client, /\/guardian\/v1\/participants\//);
    assert.match(client, /\/guardian\/v1\/alerts\//);
    assert.match(client, /Idempotency-Key/);
  }
});
