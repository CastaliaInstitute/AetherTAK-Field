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
