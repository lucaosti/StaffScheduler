#!/usr/bin/env bash
# The verification gate, run INSIDE the toolchain container (#864).
#
# Do not run this on the host: use ./scripts/verify-in-docker.sh, which starts
# the disposable database and Redis and runs this script in the container.
#
# Usage (arguments are gate names, run in order; default: all):
#   install      npm ci for the container (Linux node_modules in volumes)
#   audit        production dependency advisories (high/critical fail)
#   static       script tests, ruff, lint, typecheck, knip, madge, builds,
#                OpenAPI and generated-client drift
#   backend      backend unit suite with coverage (REQUIRE_ORTOOLS=1)
#   frontend     frontend suite with coverage
#   timezones    both suites under America/Los_Angeles and Pacific/Auckland
#   migrations   migrate up, roll back EVERY migration, reapply
#   integration  real-MySQL integration suite
#   seed         demo seed, twice (it must be idempotent)
#   e2e          Playwright against a backend using Redis
#   all          every gate above, in that order
#   serve        migrate + seed, then run backend :3001 and frontend :3000 until
#                stopped (not part of `all`)
#
# The gate list mirrors .github/workflows/ci.yml; keep the two in step.
#
# Author: Luca Ostinelli

set -euo pipefail

[ -f /.dockerenv ] || { echo "verify.sh runs inside the toolchain container; use scripts/verify-in-docker.sh" >&2; exit 2; }

ROOT=/workspace
cd "$ROOT"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

dbmate() { (cd "$ROOT/backend" && npx --no-install dbmate --no-dump-schema "$@"); }

# A fresh database AND an empty Redis per gate that needs them: both servers
# outlive a single run, and a gate must not depend on what an earlier gate or
# run left behind. Redis matters as much as MySQL here: the login limiter keeps
# its counters there, so repeated e2e runs inside its window failed with 429
# "Too many login attempts" until the cache was cleared.
reset_database() {
  mysql -h"$DB_HOST" -uroot -p"$DB_PASSWORD" -e \
    'DROP DATABASE IF EXISTS staff_scheduler; CREATE DATABASE staff_scheduler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  node -e "const R = require('ioredis'); const r = new R(process.env.REDIS_URL); r.flushall().then(() => r.quit())"
}

gate_install() {
  step "npm ci"
  npm ci --no-audit
}

# Its own gate because an advisory published upstream fails every branch at
# once; the other gates must still be runnable to tell what a change broke.
gate_audit() {
  step "dependency audit"
  npm run audit:deps
}

gate_static() {
  step "script tests"
  npm run test:scripts
  step "ruff"
  (cd backend && ruff check optimization-scripts)
  step "backend lint, typecheck, knip, madge, build"
  (cd backend && npm run lint && npm run typecheck && npm run deadcode && npm run deadcode:cycles && npm run build)
  step "OpenAPI spec is generated and drift-free"
  (cd backend && npm run openapi:generate && git diff --exit-code -- openapi)
  step "frontend lint, typecheck, knip"
  (cd frontend && npm run lint && npx tsc --noEmit && npm run deadcode)
  step "generated API client is drift-free"
  (cd frontend && npm run api:generate && git diff --exit-code -- src/api)
  step "frontend production build"
  (cd frontend && npm run build)
}

gate_backend() {
  step "backend unit suite with coverage gate (OR-Tools required)"
  (cd backend && npm run test:coverage -- --ci --runInBand --coverageReporters=text-summary)
}

gate_frontend() {
  step "frontend suite with coverage gate"
  (cd frontend && npx jest --ci --coverage --coverageReporters=text-summary)
}

gate_timezones() {
  local tz
  for tz in America/Los_Angeles Pacific/Auckland; do
    step "backend suite under $tz"
    (cd backend && TZ=$tz npx jest --ci --runInBand --silent)
    step "frontend suite under $tz"
    (cd frontend && TZ=$tz npx jest --ci --silent)
  done
}

gate_migrations() {
  reset_database
  step "migrations: up"
  dbmate up
  step "migrations: roll back every migration"
  # CI rolls back one; the whole chain is what a restore-to-empty exercises.
  local n=0
  while [ "$(mysql -N -h"$DB_HOST" -uroot -p"$DB_PASSWORD" staff_scheduler -e 'SELECT COUNT(*) FROM schema_migrations')" -gt 0 ]; do
    dbmate rollback >/dev/null
    n=$((n + 1))
  done
  local left
  left=$(mysql -N -h"$DB_HOST" -uroot -p"$DB_PASSWORD" staff_scheduler -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'staff_scheduler' AND table_name <> 'schema_migrations'")
  echo "rolled back $n migrations; tables left: $left"
  [ "$left" -eq 0 ] || { echo "down migrations left $left tables behind" >&2; return 1; }
  step "migrations: reapply"
  dbmate up
}

gate_integration() {
  step "real-MySQL integration suite"
  (cd backend && npm run test:integration)
}

seed_demo() {
  (cd backend && DB_NAME=staff_scheduler NODE_ENV=development npm run db:seed:demo)
}

gate_seed() {
  reset_database
  dbmate up
  step "demo seed (first run)"
  seed_demo
  step "demo seed (second run: must be idempotent)"
  seed_demo
}

BACKEND_PID=
# Stops the backend a gate started. Without it the server outlived the gate and
# kept the caller's output pipe open, so `verify.sh e2e | grep ...` never ended.
stop_backend() {
  [ -n "$BACKEND_PID" ] || return 0
  pkill -P "$BACKEND_PID" 2>/dev/null || true
  kill "$BACKEND_PID" 2>/dev/null || true
  pkill -f 'ts-node src/index.ts' 2>/dev/null || true
  BACKEND_PID=
}
trap stop_backend EXIT

start_backend() {
  cd "$ROOT/backend"
  DB_NAME=staff_scheduler NODE_ENV=development PORT=3001 nohup npm run dev >"$ROOT/backend/logs/verify-backend.log" 2>&1 </dev/null &
  BACKEND_PID=$!
  cd "$ROOT"
  local i
  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:3001/api/v1/health | grep -q '"redis":"connected"'; then return 0; fi
    sleep 2
  done
  echo "backend did not come up with redis connected; tail of its log:" >&2
  tail -100 "$ROOT/backend/logs/verify-backend.log" >&2
  return 1
}

gate_e2e() {
  reset_database
  dbmate up
  seed_demo
  step "Playwright e2e"
  start_backend
  local rc=0
  (cd frontend && REACT_APP_API_URL=http://127.0.0.1:3001/api/v1 E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e) || rc=$?
  stop_backend
  return "$rc"
}

gate_serve() {
  reset_database
  dbmate up
  seed_demo
  start_backend
  step "serving: frontend http://127.0.0.1:3000, API http://127.0.0.1:3001/api/v1 (Ctrl-C to stop)"
  cd frontend
  REACT_APP_API_URL=http://127.0.0.1:3001/api/v1 exec npx vite --host 0.0.0.0 --port 3000 --strictPort
}

ALL=(install audit static backend frontend timezones migrations integration seed e2e)
gates=("$@")
[ ${#gates[@]} -gt 0 ] || gates=(all)

for gate in "${gates[@]}"; do
  case "$gate" in
    all) for g in "${ALL[@]}"; do "gate_$g"; done ;;
    install|audit|static|backend|frontend|timezones|migrations|integration|seed|e2e|serve) "gate_$gate" ;;
    *) echo "unknown gate: $gate" >&2; exit 2 ;;
  esac
done

step "done: ${gates[*]}"
