import type { CapacitorConfig } from '@capacitor/cli';

// `webDir` is local (`www`), not a path into `../frontend/build`, because
// Capacitor resolves it relative to this project and expects the web assets
// to live inside the native project tree it generates here. `npm run build`
// (see package.json) builds the frontend and copies its output into `www`
// before running `cap sync`, which is the documented pattern for wrapping a
// sibling web app in a monorepo rather than fighting the tool's own layout
// assumptions.
const config: CapacitorConfig = {
  appId: 'com.staffscheduler.app',
  appName: 'Staff Scheduler',
  webDir: 'www',
};

export default config;
