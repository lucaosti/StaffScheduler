import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
    strictPort: false,
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // Expose the CRA-style env var name so existing source files need no changes.
  define: {
    'process.env.REACT_APP_API_URL': JSON.stringify(
      process.env.REACT_APP_API_URL ?? ''
    ),
  },
  // The shared workspace package ships as CommonJS (its dist re-exports the Zod
  // schemas via `export *`). It resolves through a symlink to ../packages/shared,
  // outside node_modules, so Rollup would parse it as ESM and miss the named
  // exports. Include it in the commonjs transform (build) and pre-bundle it
  // (dev) so named imports like `createScheduleBody` resolve in both modes.
  optimizeDeps: {
    include: ['@staff-scheduler/shared'],
  },
  build: {
    outDir: 'build',
    target: 'es2020',
    commonjsOptions: {
      include: [/packages\/shared/, /node_modules/],
    },
  },
});
