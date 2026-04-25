#!/usr/bin/env bash
# Demo profile orchestration.
#
# Usage:
#   ./scripts/demo.sh up        Start docker stack, wait for MySQL, init schema, seed demo data.
#   ./scripts/demo.sh reset     Truncate every app table and re-seed. Stack stays up.
#   ./scripts/demo.sh down      Stop and remove the stack and its volumes (clean slate).
#   ./scripts/demo.sh status    Show whether the stack is up and whether mode=demo is set.
#
# Author: Luca Ostinelli

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
BACKEND_DIR="${ROOT_DIR}/backend"

require_compose() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required" >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose plugin is required" >&2
    exit 1
  fi
}

wait_for_mysql() {
  echo "Waiting for MySQL to accept connections…"
  local i
  for i in $(seq 1 60); do
    if docker compose -f "${COMPOSE_FILE}" exec -T database mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1; then
      echo "MySQL is up."
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for MySQL." >&2
  exit 1
}

cmd_up() {
  require_compose
  echo "Starting Docker stack…"
  docker compose -f "${COMPOSE_FILE}" up -d
  wait_for_mysql

  echo "Initializing database schema…"
  (cd "${BACKEND_DIR}" && npm run db:init --silent)

  echo "Seeding demo data…"
  (cd "${BACKEND_DIR}" && npm run db:seed:demo --silent)

  echo
  echo "Demo is up."
  echo "Frontend: http://localhost:3000"
  echo "Backend:  http://localhost:3001/api/health"
  echo "Login:    admin@demo.staffscheduler.local / demo1234"
}

cmd_reset() {
  require_compose
  wait_for_mysql
  echo "Re-seeding demo data (idempotent: wipes app tables, re-inserts)…"
  (cd "${BACKEND_DIR}" && npm run db:seed:demo --silent)
  echo "Reset done."
}

cmd_down() {
  require_compose
  echo "Tearing down stack and dropping volumes…"
  docker compose -f "${COMPOSE_FILE}" down -v
  echo "Stack down."
}

cmd_status() {
  require_compose
  echo "Containers:"
  docker compose -f "${COMPOSE_FILE}" ps || true
  echo
  echo "Demo mode marker:"
  if docker compose -f "${COMPOSE_FILE}" exec -T database \
      mysql -uroot -p"${DB_PASSWORD:-}" -N -e \
      "SELECT category, \`key\`, value FROM \
       ${DB_NAME:-staff_scheduler}.system_settings \
       WHERE category='runtime' AND \`key\`='mode'" 2>/dev/null; then
    :
  else
    echo "  (could not read system_settings — DB may not be up)"
  fi
}

usage() {
  sed -n '2,11p' "$0"
  exit "${1:-0}"
}

case "${1:-}" in
  up) cmd_up ;;
  reset) cmd_reset ;;
  down) cmd_down ;;
  status) cmd_status ;;
  -h|--help|help|"") usage 0 ;;
  *) echo "Unknown command: $1" >&2; usage 1 ;;
esac
