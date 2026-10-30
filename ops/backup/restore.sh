#!/usr/bin/env bash
# Restore a MySQL logical backup produced by backup.sh.
#
# Usage: restore.sh <path-to-dump.sql.gz>
#        restore.sh --latest        # newest dump in BACKUP_DIR
#
# WHY a companion script (and why it's tested in CI): a backup you have never
# restored is not a backup. This script is the exact path the CI restore job
# exercises, so "our backups restore" is proven on every scheduled run rather
# than assumed. It restores into DB_NAME as-is; point DB_NAME at a scratch
# database first if you are validating rather than recovering.
#
# WHY THE DUMP IS VERIFIED BEFORE THE SERVER SEES IT (#846). `gunzip | mysql`
# without pipefail reports mysql's status, and mysql happily applies a stream
# that simply stops: a corrupt or truncated archive restored half a database and
# reported success. The archive is now checked end to end first — it must
# decompress and end in mysqldump's `-- Dump completed` trailer — so a bad file
# is refused while the target database is still untouched; pipefail then makes
# a failure during the restore itself fail the script. Verifying first costs a
# second decompression, which is cheap next to replaying the SQL.
#
# Env: DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_DIR
set -euo pipefail

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-staff_scheduler}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

ARG="${1:-}"
if [ -z "$ARG" ]; then
  echo "usage: restore.sh <dump.sql.gz | --latest>" >&2
  exit 2
fi

if [ "$ARG" = "--latest" ]; then
  # backup.sh writes to *.sql.gz.tmp until a dump is verified, so this glob
  # only ever sees completed dumps.
  DUMP="$(ls -1t "$BACKUP_DIR/${DB_NAME}"_*.sql.gz 2>/dev/null | head -n 1 || true)"
  if [ -z "$DUMP" ]; then
    echo "[restore] ERROR: no backups found in ${BACKUP_DIR}" >&2
    exit 1
  fi
else
  DUMP="$ARG"
fi

if [ ! -f "$DUMP" ]; then
  echo "[restore] ERROR: dump not found: ${DUMP}" >&2
  exit 1
fi

echo "[restore] verifying ${DUMP}"
if ! gzip -dc "$DUMP" | tail -n 1 | grep -q '^-- Dump completed'; then
  echo "[restore] ERROR: ${DUMP} is corrupt or truncated (no completion trailer) — refusing to restore it" >&2
  exit 1
fi

echo "[restore] ensuring database ${DB_NAME} exists"
mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="${DB_PASSWORD:-}" \
  -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;"

echo "[restore] restoring ${DUMP} into ${DB_NAME}"
gzip -dc "$DUMP" | mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --password="${DB_PASSWORD:-}" "$DB_NAME"

echo "[restore] done"
