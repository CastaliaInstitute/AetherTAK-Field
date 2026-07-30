import assert from "node:assert/strict";
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
