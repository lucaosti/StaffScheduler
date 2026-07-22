#!/bin/sh
# MySQL logical backup with retention.
#
# WHY mysqldump (and not a binary/volume snapshot): the schema is owned by
# dbmate migrations, so a portable logical dump restores cleanly onto any MySQL
# 8 of the same or newer schema version — it is the backup that pairs with the
# migration story. A single-transaction dump is consistent without locking the
# tables, so it can run against a live database.
#
# WHY gzip + timestamped names + retention: one self-describing file per run
# keeps restore trivial (pick a file, pipe it back in), and pruning by age keeps
# disk bounded. Retention is deliberately simple (delete files older than N
# days) rather than a GFS scheme — adequate for a self-hosted deployment and
# easy to reason about.
#
# Env: DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_DIR BACKUP_RETENTION_DAYS
set -eu

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-staff_scheduler}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

echo "[backup] dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT} -> ${OUT}"
# --single-transaction: consistent snapshot without locking (InnoDB).
# --routines --triggers --events: capture the full schema, not just tables.
# --no-tablespaces: avoids needing the PROCESS privilege on managed MySQL.
mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="${DB_PASSWORD:-}" \
  --single-transaction --routines --triggers --events --no-tablespaces \
  "$DB_NAME" | gzip -c > "$OUT"

# Fail loudly if the dump is suspiciously small (empty/failed dumps gzip tiny).
SIZE="$(wc -c < "$OUT")"
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] ERROR: dump ${OUT} is only ${SIZE} bytes — treating as failure" >&2
  rm -f "$OUT"
  exit 1
fi
echo "[backup] wrote ${OUT} (${SIZE} bytes)"

echo "[backup] pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "[backup] done"
