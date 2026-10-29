/**
 * Every Capacitor plugin the frontend imports must be a dependency of this
 * package.
 *
 * `cap sync` discovers native plugins from mobile/package.json only, never
 * from the frontend workspace that actually imports them. A plugin declared
 * on the frontend alone compiles, bundles and passes every web test, then is
 * missing from the generated Gradle and Swift package files, so the native app
 * fails at runtime on the first call into it. Nothing short of a device build
 * notices, which is why this check exists.
 *
 * @author Luca Ostinelli
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const frontendSrc = path.join(mobileDir, '..', 'frontend', 'src');

const CAPACITOR_IMPORT = /from\s+['"](@capacitor\/[a-z0-9-]+)['"]/g;

function capacitorImports(dir) {
  const found = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
    const source = readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
    for (const match of source.matchAll(CAPACITOR_IMPORT)) found.add(match[1]);
  }
  return found;
}

test('every @capacitor/* package imported by the frontend is a mobile dependency', () => {
  const { dependencies = {} } = JSON.parse(readFileSync(path.join(mobileDir, 'package.json'), 'utf8'));
  const imported = capacitorImports(frontendSrc);
  // Guards the scan itself: if the pattern or the path drifted, an empty set
  // would make the assertion below pass vacuously.
  assert.ok(imported.has('@capacitor/core'), 'expected the frontend to import @capacitor/core');
  const missing = [...imported].filter((name) => !(name in dependencies)).sort();
  assert.deepEqual(missing, [], `missing from mobile/package.json dependencies: ${missing.join(', ')}`);
});
