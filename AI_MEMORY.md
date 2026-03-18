# StaffScheduler – AI memory / invariants

Questo file raccoglie **le scelte implementative e gli invarianti** che devono restare coerenti tra backend, database e frontend.
Non sostituisce la documentazione, ma serve come “memo” operativo.

## Architettura (stato attuale)
- **Backend**: Node + Express + TypeScript, MySQL (`mysql2/promise`), JWT auth.
- **Frontend**: React (CRA) + TypeScript, servizi `fetch` verso `http://localhost:3001/api`.
- **Database schema**: fonte di verità è `backend/database/init.sql`.

## Database – schema (campi chiave)
### `users`
- `id` INT PK
- `email` UNIQUE
- `password_hash` (bcrypt)
- `role` in `('admin','manager','employee')`
- `employee_id` (string, opzionale)

### `schedules`
Lo schema include (oltre ai campi base):
- `department_id` INT **NOT NULL** (FK `departments.id`)
- `created_by` INT **NOT NULL** (FK `users.id`)
- `notes` TEXT (opzionale)

### `shift_assignments`
Lo schema include:
- `status` enum: `('pending','confirmed','completed','cancelled')`
- `assigned_by` INT NULL (FK `users.id`)
- `created_at`, `updated_at` (presenti)

### `user_skills`
Include:
- `proficiency_level` INT (default 1) per supportare `EmployeeService`.

## Script DB init (NO demo / NO mock)
File: `backend/scripts/init-database.ts`
- Crea il DB (se necessario), esegue `backend/database/init.sql`.
- **Non** inserisce utenti, reparti o altri dati applicativi: il DB parte **vuoto** (eccetto gli `INSERT IGNORE` di `skills` e `system_settings` già nello schema).

## Backend – endpoint “di base” (attesi)
- **Health**: `GET /api/health` (root del router health)
- **Auth**:
  - `POST /api/auth/login`
  - `GET /api/auth/verify`
  - `POST /api/auth/refresh` (**genera nuovo JWT**)
- **Core**:
  - `GET /api/dashboard/stats` (query coerenti con schema reale)
  - `GET /api/departments` (router registrato)
  - `GET /api/employees` (employees = users role employee)
  - `GET /api/schedules`, `POST /api/schedules` (richiede `created_by` lato server)

## Frontend – invarianti di integrazione
### Base URL
- `REACT_APP_API_URL` deve essere tipo `http://localhost:3001/api`
- In `frontend/src/services/scheduleService.ts` **NON** si deve aggiungere un secondo `/api`.

### Tipi
File: `frontend/src/types/index.ts`
- Gli ID principali sono trattati come `ID = number | string` per compatibilità.
- `Assignment.status` include `pending/confirmed/completed/cancelled` (coerente col backend).
- `Shift.status` include `open/assigned/confirmed/cancelled` (coerente col backend).
- Alcuni campi “legacy” restano **opzionali** (UI storica), ma non sono garantiti dall’API.

### Allineamenti già fatti
- `Employees` UI ora usa **`employee.id`** (numeric user id) per delete/update, non `employeeId` stringa.
- `Schedule` UI usa `assignment.userId` (fallback su `employeeId` solo se presente).
- `scheduleService` e `shiftService` accettano id `string | number`.

## Codice potenzialmente “vecchio / non usato”
Queste cose NON rompono la build, ma sono candidate a refactor/cleanup:
- `backend/src/services/AuthService.ts`: implementato ma le routes auth usano `UserService` direttamente (potenziale dead code).
- Alcune schermate UI (`Settings`, parti “hospital hierarchy”) sono basate su un modello legacy non presente nel backend: restano UI-only.

## Verifica rapida manuale (quando hai Docker/DB)
1) Backend:
   - `cd backend && npm run db:init`
   - `cd backend && npm run dev`
   - Prova `GET /api/health`
2) Frontend:
   - `cd frontend && npm start`
   - Crea utenti reali via UI/API e poi fai login

