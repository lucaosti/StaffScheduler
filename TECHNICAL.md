# Technical overview

This file is a long-form architecture companion. It is intentionally a
high-level description; for any concrete contract or convention, defer
to the authoritative sources.

## Authoritative sources

- **API contract** — [`backend/openapi/openapi.json`](backend/openapi/openapi.json),
  served live at `/api/docs` (Swagger UI).
- **API reference (curated)** — [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md).
- **Architecture conventions** (pool injection, route ↔ service split,
  response envelope, logging, types) — [`CLAUDE.md`](CLAUDE.md).
- **Contributor workflow** — [`CONTRIBUTING.md`](CONTRIBUTING.md).

## System architecture

Three-tier separation of concerns:

```
┌─────────────────────┐    HTTPS    ┌─────────────────────┐    SQL    ┌──────────────────┐
│  Frontend (React)   │ ──────────► │  Backend (Express)  │ ───────► │  MySQL 8         │
│  TypeScript SPA     │ ◄────────── │  TypeScript REST    │ ◄─────── │  pooled access   │
└─────────────────────┘    JSON     └─────────────────────┘          └──────────────────┘
```

The frontend is a React SPA. The backend is a stateless Express REST
API. State lives entirely in MySQL — no in-memory session, no Redis.
JWTs are stored client-side in `localStorage`; the backend validates
them per request.

### Backend modules

- `src/config/` — configuration, logger, database pool factory.
- `src/middleware/` — `authenticate`, `requireManager`, error handler,
  validation helpers.
- `src/routes/` — 25 mounted routers (`/api/auth`, `/api/users`, …).
  Each router is created by a `createXRouter(pool)` factory and exposes
  endpoints; it does not hold business logic.
- `src/services/` — one service per domain. Services receive the pool
  in the constructor (`pool: Pool` injection pattern), expose async
  methods that return plain objects, and own all SQL.
- `src/optimization/` — bridge to the Python OR-Tools optimizer.
- `src/types/` — shared TypeScript types.

### Frontend modules

- `src/pages/` — top-level route components.
- `src/components/` — reusable UI primitives, plus chrome (`DemoBanner`,
  navigation).
- `src/contexts/` — `AuthContext` (token + current user).
- `src/services/` — typed client per backend domain. All clients use
  `apiUtils.handleResponse` and `apiUtils.getAuthHeaders` for envelope
  parsing and `Authorization` header injection.
- `src/types/` — shared TypeScript types matching the API.

## Response envelope

All API responses follow:

```ts
type ApiResponse<T> =
  | { success: true;  data: T }
  | { success: false; error: { code: string; message: string } };
```

`apiUtils.handleResponse` parses this envelope and throws `ApiError`
(carrying the HTTP status) for non-2xx responses. Service clients call
`handleResponse` exclusively — they never inspect raw `fetch` results.

The full response/request schemas are in `backend/openapi/openapi.json`.

## Authentication and authorization

- Login: `POST /api/auth/login` with `{ email, password }`. Backend
  verifies the bcrypt hash, signs a JWT (7-day expiry by default), and
  returns `{ token, user }`.
- The frontend stores the JWT in `localStorage`. `getAuthHeaders()`
  injects `Authorization: Bearer <token>` on outbound requests.
- Backend middleware:
  - `authenticate` — verifies the JWT and attaches `req.user`.
  - `requireManager` — gates manager-only routes (reports, schedule
    publishing, etc.).
- Server-side logout is informational. JWT blacklisting (revoking a
  token before its natural expiry) would require a `revoked_tokens`
  table or a short-TTL cache keyed by `jti`; not currently implemented.

## Database

- Schema source of truth: [`backend/database/init.sql`](backend/database/init.sql).
- Schema bootstrap: `npm run db:init` (idempotent, schema only — no
  users, no demo data).
- Demo seed: `npm run db:seed:demo` (idempotent, `TRUNCATE` + reinsert,
  every row is marked `[DEMO]` and the runtime mode is set to `demo`).

Connection pooling is handled by `mysql2/promise`. Services use
parameterized queries exclusively; dynamic `UPDATE` statements
construct column lists from a hardcoded allow-list and bind every user
value via `?` placeholders. There are no string-concatenated values in
SQL.

## Demo profile

The `system_settings` row `(category='runtime', key='mode')` controls
the runtime mode. Values:

- `production` (default when the row is absent or unset)
- `demo` (set by the demo seed)
- `development` (reserved)

`GET /api/system/info` exposes only `{ mode }`. The frontend reads it
once at boot and renders `DemoBanner` if `mode === 'demo'`. Nothing
else in the application code branches on this flag.

The orchestration script `scripts/demo.sh` wraps three flows:

- `up` — `docker compose up -d mysql` → wait for MySQL → `db:init` →
  `db:seed:demo` → `npm run dev` (frontend + backend if requested).
- `reset` — re-runs only `db:seed:demo` against the running stack.
- `down` — `docker compose down -v` (drops the volume, full clean
  slate).

## Optimization

The optimizer is a Python process invoked from `src/optimization/`.
The model is a CP-SAT formulation:

- Variables — one boolean per `(employee, shift)` candidate assignment.
- Hard constraints — coverage windows, no overlap, declared
  availability, weekly hour caps, required skills.
- Soft constraints — preferences, fairness, consecutive-day caps,
  minimum rest. Each is added with a configurable weight.
- Objective — weighted sum to minimize.

The bridge serializes input as JSON, calls
`backend/optimization-scripts/schedule_optimizer.py`, and parses the
JSON response. The exact JSON contract is documented inline in the
Python script.

## Logging

`src/config/logger.ts` exports a Winston logger. Console output is
suppressed in test runs. All errors caught in routes/services log
through `logger.error(...)` with a structured payload — `console.*` is
not used outside of one-off scripts.

## Real-time events

`F18` ships a server-sent events bus:

- Backend route: `GET /api/events/stream` (authenticated).
- Backend bus: `src/services/EventBus.ts` (in-memory pub/sub).
- Frontend client: `src/services/eventStream.ts` (typed `EventSource`
  wrapper).

It is opt-in; the rest of the application works without subscribers.

## Tests

Each domain has matching tests at the layer where it lives:

- `backend/src/__tests__/services/` — service-layer unit tests against
  a mocked pool.
- `backend/src/__tests__/routes/` — Supertest-driven route smoke tests.
- `backend/src/__tests__/integration/` — end-to-end happy paths.
- `backend/src/__tests__/optimization/` — CP-SAT optimizer tests.
- `frontend/src/**/__tests__/` — component and service unit tests with
  Jest + React Testing Library; smoke tests use mocked
  `apiUtils.handleResponse`.

CI runs the same commands a developer runs locally (`npm run lint`,
`npm run build`, `npm test`, plus the frontend `CI=true npm run build`).

## Deployment

There is no production deployment manifest in this repository today;
`docker-compose.yml` covers local development only. A recommended
production topology is:

- Reverse proxy (Nginx, CloudFront) terminating TLS.
- Express API behind the proxy, horizontally scalable (it is stateless).
- MySQL 8 (managed instance preferred).
- Static frontend bundle (`npm run build`) served by the proxy.

Operational follow-ups (centralized log shipping, metrics, JWT
revocation list, secrets manager) are intentionally out of scope for
this repo today.
