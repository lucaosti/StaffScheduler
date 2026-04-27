# End-to-end smoke tests

These [Playwright](https://playwright.dev/) tests exercise the real UI
against a running demo stack (frontend + backend + seeded MySQL).

## Prerequisites

1. Backend + seeded MySQL running (see top-level `README.md`):

   ```bash
   ./scripts/demo.sh         # brings the full stack up
   # or, manually:
   cd backend && npm run db:seed:demo && npm run dev
   ```

2. Install Chromium (one-time):

   ```bash
   cd frontend
   npx playwright install --with-deps chromium
   ```

The frontend dev server **does not** need to be started manually:
Playwright's `webServer` block in `playwright.config.ts` boots
`npm start` automatically and shuts it down at the end of the run.
If you already have a frontend dev server up at `http://localhost:3000`,
Playwright reuses it (set `E2E_SKIP_WEB_SERVER=1` to disable that
behaviour entirely).

## Running

```bash
cd frontend
npm run test:e2e
```

The tests assume:

- Frontend at `http://localhost:3000` (override with `E2E_BASE_URL`).
- Backend at `http://localhost:3001` (override with `REACT_APP_API_URL`).
- Default demo credentials: `admin@demo.staffscheduler.local` / `demo1234`
  and `emergency.manager@demo.staffscheduler.local` / `demo1234`.

## CI

The same suite runs as the **required** `Frontend e2e (Playwright)`
job in `.github/workflows/ci.yml`. That job:

1. Boots a `mysql:8.0` service container.
2. Loads `backend/database/init.sql` and seeds demo data
   (`npm run db:seed:demo`).
3. Starts the backend on port 3001 and waits for `/api/health`.
4. Lets Playwright's `webServer` block start the CRA frontend.
5. Uploads the Playwright HTML report (and traces on failure) as
   build artifacts so PR reviewers can debug failures.

## Coverage

| File | Flow |
| --- | --- |
| `auth.spec.ts` | Admin and manager can sign in and reach the dashboard. |
| `schedule.spec.ts` | Admin can open the New Schedule modal and create a schedule. |
| `theme.spec.ts` | Theme toggle switches `data-bs-theme` between `light` and `dark`. |
