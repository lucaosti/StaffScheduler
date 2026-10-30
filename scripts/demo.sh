#!/usr/bin/env bash
# Demo profile orchestration.
#
# Usage:
#   ./scripts/demo.sh up        Start docker stack, wait for MySQL, init schema, seed demo data.
#   ./scripts/demo.sh reset     Truncate every app table and re-seed. Stack stays up.
#   ./scripts/demo.sh down      Stop and remove the demo stack and its volumes (clean slate).
#   ./scripts/demo.sh status    Show whether the stack is up and whether mode=demo is set.
#
# Runs as the separate compose project "staffscheduler-demo": nothing here
# touches the deployment started by start.sh or `docker compose up`.
#
# Author: Luca Ostinelli

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
BACKEND_DIR="${ROOT_DIR}/backend"

# The demo is its own compose project (#847). Under the deployment's default
# project, `down -v` deleted the production database volume — the demo and
# the deployment were the same containers and volumes. With a separate name
# the demo gets its own volumes and `down -v` can only remove those. Same file,
# not a copy: the demo should run exactly what is deployed. The services' fixed
# container_names still collide, so the demo refuses to start while the
# deployment runs on the same host, rather than sharing anything with it.
DEMO_PROJECT="staffscheduler-demo"
compose() { docker compose -p "${DEMO_PROJECT}" -f "${COMPOSE_FILE}" "$@"; }

# docker compose loads ROOT_DIR/.env on its own for variable substitution
# inside docker-compose.yml, but this script's own `${MYSQL_ROOT_PASSWORD}`
# read below runs in the host shell, which does not see it automatically.
# Extract just the keys we need instead of `source`-ing the file: .env allows
# unquoted values with spaces (e.g. REACT_APP_APP_NAME=Staff Scheduler),
# which is valid for docker compose's own parser but not for bash `source`.
env_file_value() {
  local key="$1" file="${ROOT_DIR}/.env"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2-
}
: "${MYSQL_ROOT_PASSWORD:=$(env_file_value MYSQL_ROOT_PASSWORD)}"
: "${MYSQL_DATABASE:=$(env_file_value MYSQL_DATABASE)}"

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
    if compose exec -T mysql mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1; then
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
  compose up -d
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
  echo "Tearing down the ${DEMO_PROJECT} stack and dropping its volumes…"
  compose down -v
  echo "Stack down."
}

cmd_status() {
  require_compose
  echo "Containers:"
  compose ps || true
  echo
  echo "Demo mode marker:"
  if compose exec -T mysql \
      mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-}" -N -e \
      "SELECT category, \`key\`, value FROM \
       ${MYSQL_DATABASE:-staff_scheduler}.system_settings \
       WHERE category='runtime' AND \`key\`='mode'" 2>/dev/null; then
    :
  else
    echo "  (could not read system_settings — DB may not be up)"
  fi
}

usage() {
  sed -n '2,12p' "$0"
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
