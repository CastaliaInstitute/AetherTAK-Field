import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXPECTED_IOS_TYPES = [
  "NSPrivacyCollectedDataTypePreciseLocation",
  "NSPrivacyCollectedDataTypeCoarseLocation",
  "NSPrivacyCollectedDataTypeUserID",
  "NSPrivacyCollectedDataTypeEmailsOrTextMessages",
  "NSPrivacyCollectedDataTypePhotosorVideos",
  "NSPrivacyCollectedDataTypeAudioData",
  "NSPrivacyCollectedDataTypeOtherUserContent",
  "NSPrivacyCollectedDataTypeEnvironmentScanning",
];

const REQUIRED_ANDROID_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
];

const FORBIDDEN_ANDROID_PERMISSIONS = [
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
];

const mustInclude = (value, expected, source) => {
  if (!value.includes(expected)) {
    throw new Error(`${source} is missing ${expected}`);
  }
};

export async function verifyStoreCompliance(rootDirectory) {
  const read = (relativePath) =>
    readFile(path.join(rootDirectory, relativePath), "utf8");
  const [
    privacyManifest,
    xcodeProject,
    androidManifest,
    androidExtractionRules,
    androidFilePaths,
    androidVariables,
    androidMainActivity,
    androidDepthActivity,
    androidRecentsPrivacy,
    iosAppDelegate,
    iosMediaPlugin,
    observationCapture,
    missionPackages,
    practicesSource,
    appleAnswers,
    playAnswers,
    listing,
  ] = await Promise.all([
    read("ios/App/App/PrivacyInfo.xcprivacy"),
    read("ios/App/App.xcodeproj/project.pbxproj"),
    read("android/app/src/main/AndroidManifest.xml"),
    read("android/app/src/main/res/xml/data_extraction_rules.xml"),
    read("android/app/src/main/res/xml/file_paths.xml"),
    read("android/variables.gradle"),
    read("android/app/src/main/java/org/castaliainstitute/aethertak/field/MainActivity.kt"),
    read("android/app/src/main/java/org/castaliainstitute/aethertak/field/depth/AetherDepthCaptureActivity.kt"),
    read("android/app/src/main/java/org/castaliainstitute/aethertak/field/privacy/RecentsPrivacy.kt"),
    read("ios/App/App/AppDelegate.swift"),
    read("ios/App/App/AetherMediaIntegrityPlugin.swift"),
    read("src/media/observationCapture.ts"),
    read("src/tak/missionPackage.ts"),
    read("store/privacy-practices.json"),
    read("store/app-store-privacy.md"),
    read("store/google-play-data-safety.md"),
    read("store/listing/en-US.md"),
  ]);

  mustInclude(privacyManifest, "<key>NSPrivacyTracking</key>", "iOS privacy manifest");
  mustInclude(privacyManifest, "<false/>", "iOS privacy manifest");
  mustInclude(privacyManifest, "NSPrivacyAccessedAPICategoryUserDefaults", "iOS privacy manifest");
  mustInclude(privacyManifest, "CA92.1", "iOS privacy manifest");
  mustInclude(privacyManifest, "NSPrivacyAccessedAPICategoryFileTimestamp", "iOS privacy manifest");
  mustInclude(privacyManifest, "C617.1", "iOS privacy manifest");
  for (const type of EXPECTED_IOS_TYPES) {
    mustInclude(privacyManifest, type, "iOS privacy manifest");
  }
  mustInclude(xcodeProject, "PrivacyInfo.xcprivacy in Resources", "Xcode project");

  for (const permission of REQUIRED_ANDROID_PERMISSIONS) {
    mustInclude(androidManifest, permission, "Android manifest");
  }
  for (const permission of FORBIDDEN_ANDROID_PERMISSIONS) {
    if (androidManifest.includes(permission)) {
      throw new Error(`Android manifest contains forbidden broad permission ${permission}`);
    }
  }
  mustInclude(androidManifest, 'android:allowBackup="false"', "Android manifest");
  mustInclude(androidManifest, 'android:fullBackupContent="false"', "Android manifest");
  mustInclude(
    androidManifest,
    'android:dataExtractionRules="@xml/data_extraction_rules"',
    "Android manifest",
  );
  for (const section of ["cloud-backup", "device-transfer"]) {
    mustInclude(androidExtractionRules, `<${section}>`, "Android extraction rules");
  }
  for (const domain of [
    "root",
    "file",
    "database",
    "sharedpref",
    "external",
    "device_root",
    "device_file",
    "device_database",
    "device_sharedpref",
  ]) {
    mustInclude(
      androidExtractionRules,
      `domain="${domain}" path="."`,
      "Android extraction rules",
    );
  }
  if (androidFilePaths.includes("<external-path")) {
    throw new Error("Android FileProvider must not expose shared external storage");
  }
  for (const scopedPath of ["<files-path", "<cache-path", "<external-files-path"]) {
    mustInclude(androidFilePaths, scopedPath, "Android FileProvider paths");
  }
  mustInclude(androidVariables, "targetSdkVersion = 36", "Android SDK configuration");
  mustInclude(
    androidRecentsPrivacy,
    "setRecentsScreenshotEnabled(false)",
    "Android task-switcher privacy policy",
  );
  mustInclude(
    androidRecentsPrivacy,
    "WindowManager.LayoutParams.FLAG_SECURE",
    "Android legacy task-switcher privacy policy",
  );
  for (const [source, label] of [
    [androidMainActivity, "Android main activity"],
    [androidDepthActivity, "Android depth activity"],
  ]) {
    mustInclude(source, "RecentsPrivacy.configure(this)", label);
    mustInclude(source, "RecentsPrivacy.obscureBeforePause(this)", label);
    mustInclude(source, "RecentsPrivacy.revealAfterResume(this)", label);
  }
  mustInclude(iosAppDelegate, "isExcludedFromBackup = true", "iOS app storage policy");
  mustInclude(
    iosAppDelegate,
    "completeUntilFirstUserAuthentication",
    "iOS app storage policy",
  );
  mustInclude(iosAppDelegate, "showPrivacyShield()", "iOS task-switcher privacy policy");
  mustInclude(iosAppDelegate, "hidePrivacyShield()", "iOS task-switcher privacy policy");
  mustInclude(
    iosAppDelegate,
    "Protected while inactive",
    "iOS task-switcher privacy policy",
  );
  mustInclude(iosMediaPlugin, "isExcludedFromBackup = true", "iOS media policy");
  mustInclude(
    iosMediaPlugin,
    "completeUntilFirstUserAuthentication",
    "iOS media policy",
  );
  mustInclude(
    observationCapture,
    "Directory.LibraryNoCloud",
    "Observation media persistence",
  );
  mustInclude(
    missionPackages,
    "Directory.LibraryNoCloud",
    "Mission-package persistence",
  );

  const practices = JSON.parse(practicesSource);
  if (practices.tracking !== false || practices.advertising !== false) {
    throw new Error("Canonical privacy inventory must prohibit tracking and advertising");
  }
  for (const item of practices.dataTypes) {
    for (const label of item.apple) {
      mustInclude(appleAnswers, label, "App Store privacy answers");
    }
    for (const label of item.googlePlay) {
      mustInclude(playAnswers, label, "Google Play Data safety answers");
    }
  }

  const shortDescription = listing.match(
    /## Short description\s+([\s\S]*?)\s+## Full description/,
  )?.[1].trim();
  const fullDescription = listing.match(
    /## Full description\s+([\s\S]*?)\s+## Release notes/,
  )?.[1].trim();
  if (!shortDescription || shortDescription.length > 80) {
    throw new Error("Store short description must be present and at most 80 characters");
  }
  if (!fullDescription || fullDescription.length > 4000) {
    throw new Error("Store full description must be present and at most 4000 characters");
  }

  return {
    androidTargetSdk: 36,
    dataTypeCount: practices.dataTypes.length,
    iosCollectedTypeCount: EXPECTED_IOS_TYPES.length,
    shortDescriptionLength: shortDescription.length,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const rootDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = await verifyStoreCompliance(rootDirectory);
  console.log(
    `Store compliance gate passed: ${result.iosCollectedTypeCount} iOS data types, ` +
      `${result.dataTypeCount} canonical groups, Android target API ${result.androidTargetSdk}.`,
  );
}
