#!/usr/bin/env bash
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
# WHY A DUMP IS ONLY KEPT ONCE IT IS PROVEN COMPLETE (#846). Without pipefail,
# `mysqldump | gzip` reports gzip's status, so a dump that died halfway was kept
# under its final name; retention then deleted the older good dumps and
# `restore.sh --latest` picked the broken one. Now a run writes to a .tmp file,
# which neither the retention glob nor restore.sh matches; the dump must end in
# mysqldump's own `-- Dump completed` trailer (written only after the last
# table, and only by a run that finished); only then is it renamed — atomically,
# in the same directory — to its final name, and only then are old dumps pruned.
# Checks rejected: the former "under 1 KB" heuristic, which passes any partial
# dump of a real database (and fails a legitimately tiny one), and pipefail
# alone, which misses a mysqldump that exits 0 on a truncated stream. bash, not
# sh, because not every sh has pipefail (Debian's dash 0.5.12 rejects it); the
# mysql image ships bash.
#
# Env: DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_DIR BACKUP_RETENTION_DAYS
set -euo pipefail

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-staff_scheduler}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"
TMP="${OUT}.tmp"
# Whatever happens below, a failed run leaves no partial file behind.
trap 'rm -f "$TMP"' EXIT

echo "[backup] dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT} -> ${OUT}"
# --single-transaction: consistent snapshot without locking (InnoDB).
# --routines --triggers --events: capture the full schema, not just tables.
# --no-tablespaces: avoids needing the PROCESS privilege on managed MySQL.
# Comments stay on (no --skip-comments/--compact): the trailer is one of them.
mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="${DB_PASSWORD:-}" \
  --single-transaction --routines --triggers --events --no-tablespaces \
  "$DB_NAME" | gzip -c > "$TMP"

if ! gzip -dc "$TMP" | tail -n 1 | grep -q '^-- Dump completed'; then
  echo "[backup] ERROR: ${TMP} does not end with mysqldump's completion trailer — discarded" >&2
  exit 1
fi

mv "$TMP" "$OUT"
echo "[backup] wrote ${OUT} ($(wc -c < "$OUT") bytes)"

# Only after a dump has been verified and renamed: a failing run must never
# cost the dumps that are still good. Leftover .tmp files from a run killed
# before its trap fired are swept too, once they are older than a day.
echo "[backup] pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz.tmp" -type f -mtime +1 -print -delete

echo "[backup] done"
