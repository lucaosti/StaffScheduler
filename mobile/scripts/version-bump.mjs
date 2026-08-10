// Keeps the three places the mobile app's version lives in sync, with
// `mobile/package.json`'s `version` field as the single source of truth
// (the same role it plays for `backend/package.json` and
// `frontend/package.json` elsewhere in this monorepo). Capacitor's own
// config (`capacitor.config.ts`) has no version field of its own — it only
// carries `appId`/`appName`/`webDir` — so it is not one of the sync
// targets; the two native project files are:
//
//   - iOS:     `ios/App/App.xcodeproj/project.pbxproj`
//              MARKETING_VERSION      -> user-visible version (e.g. "1.2.0")
//              CURRENT_PROJECT_VERSION -> build number, an integer that must
//                                         strictly increase on every App
//                                         Store Connect upload, even for the
//                                         same marketing version
//   - Android: `android/app/build.gradle`
//              versionName  -> user-visible version (e.g. "1.2.0")
//              versionCode  -> build number, an integer that must strictly
//                              increase on every Play Console upload
//
// Both native build numbers are bumped by 1 on every run, independent of
// whether the marketing version changed — that matches how both stores
// actually gate uploads (a re-submission of the identical marketing version
// still needs a new build number).
//
// Usage:
//   node scripts/version-bump.mjs                 # sync build numbers only,
//                                                  # using the current
//                                                  # package.json version
//   node scripts/version-bump.mjs 1.2.0            # also set the marketing
//                                                  # version everywhere
//
// This only edits files on disk — it does not commit, tag, or build
// anything. Review the diff (especially the native project files) before
// committing a release.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = path.join(mobileDir, 'package.json');
const pbxprojPath = path.join(
  mobileDir,
  'ios',
  'App',
  'App.xcodeproj',
  'project.pbxproj'
);
const buildGradlePath = path.join(mobileDir, 'android', 'app', 'build.gradle');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function readPackageVersion() {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
}

function writePackageVersion(version) {
  const raw = readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.version = version;
  // Preserve trailing newline convention.
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function syncIOS(version) {
  let content = readFileSync(pbxprojPath, 'utf8');

  content = content.replace(
    /MARKETING_VERSION = [^;]+;/g,
    `MARKETING_VERSION = ${version};`
  );

  let nextBuild = null;
  content = content.replace(
    /CURRENT_PROJECT_VERSION = (\d+);/g,
    (_match, current) => {
      nextBuild = String(Number(current) + 1);
      return `CURRENT_PROJECT_VERSION = ${nextBuild};`;
    }
  );

  writeFileSync(pbxprojPath, content);
  return nextBuild;
}

function syncAndroid(version) {
  let content = readFileSync(buildGradlePath, 'utf8');

  content = content.replace(
    /versionName\s+"[^"]+"/,
    `versionName "${version}"`
  );

  let nextCode = null;
  content = content.replace(/versionCode\s+(\d+)/, (_match, current) => {
    nextCode = String(Number(current) + 1);
    return `versionCode ${nextCode}`;
  });

  writeFileSync(buildGradlePath, content);
  return nextCode;
}

const requestedVersion = process.argv[2];

if (requestedVersion && !SEMVER_RE.test(requestedVersion)) {
  console.error(
    `Invalid version "${requestedVersion}" — expected semver "X.Y.Z" (e.g. 1.2.0).`
  );
  process.exit(1);
}

if (requestedVersion) {
  writePackageVersion(requestedVersion);
}

const version = readPackageVersion();
const iosBuild = syncIOS(version);
const androidCode = syncAndroid(version);

console.log(`Marketing version: ${version}`);
console.log(`iOS CURRENT_PROJECT_VERSION -> ${iosBuild}`);
console.log(`Android versionCode -> ${androidCode}`);
console.log(
  'Review the diff in ios/App/App.xcodeproj/project.pbxproj and android/app/build.gradle before committing.'
);
