// Copies the built frontend (frontend/build, the Vite `outDir`) into this
// package's own `www/` directory. Capacitor's `webDir` config is resolved
// relative to the Capacitor project itself (this directory), not to an
// arbitrary sibling — pointing `webDir` straight at `../frontend/build`
// works for `cap sync` but breaks `cap open ios/android`, which expect the
// web assets to already live under the native project tree that Capacitor
// generates inside this directory. Copying into a local `www/` first is the
// documented pattern for a monorepo layout with the web app in a sibling
// package, and keeps this package runnable on its own without reaching back
// into `frontend/` at sync time.
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(mobileDir, '..', 'frontend', 'build');
const destination = path.join(mobileDir, 'www');

if (!existsSync(source)) {
  console.error(
    `Frontend build output not found at ${source}. Run "npm run build --workspace=frontend" first.`
  );
  process.exit(1);
}

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

console.log(`Copied ${source} -> ${destination}`);
