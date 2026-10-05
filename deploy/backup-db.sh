#!/usr/bin/env bash
#
# backup-db.sh — Daily SQLite backup for CPCMS with 14-day retention.
#
# Takes a consistent, online backup of the live SQLite database using the
# SQLite ".backup" command (WAL-safe — a plain `cp` of the .db file can miss
# un-checkpointed writes held in the -wal file). Backups are gzip-compressed
# and timestamped; anything older than the retention window is pruned.
#
# This script does NOT stop the app and is safe to run while CPCMS is serving.
#
# Usage:
#   deploy/backup-db.sh
#
# Override defaults with environment variables:
#   CPCMS_BACKEND_DIR   backend directory            (default: <repo>/backend)
#   CPCMS_DB_PATH       path to the SQLite db        (default: $CPCMS_BACKEND_DIR/data/cpcms.db)
#   CPCMS_BACKUP_DIR    where backups are written    (default: $CPCMS_BACKEND_DIR/data/backups)
#   CPCMS_RETENTION_DAYS  days of backups to keep    (default: 14)
#
# Install as a daily cron job (see deploy/README.md). Exits non-zero on any
# failure so cron/MAILTO surfaces the error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND_DIR="${CPCMS_BACKEND_DIR:-$REPO_ROOT/backend}"
DB_PATH="${CPCMS_DB_PATH:-$BACKEND_DIR/data/cpcms.db}"
BACKUP_DIR="${CPCMS_BACKUP_DIR:-$BACKEND_DIR/data/backups}"
RETENTION_DAYS="${CPCMS_RETENTION_DAYS:-14}"

log() { printf '[backup-db] %s\n' "$*"; }

if [ ! -f "$DB_PATH" ]; then
  log "ERROR: database not found at $DB_PATH"
  log "Set CPCMS_DB_PATH if the database lives elsewhere."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/cpcms-$TIMESTAMP.db"

log "Backing up $DB_PATH -> $OUT.gz"

if command -v sqlite3 >/dev/null 2>&1; then
  # Online, WAL-consistent snapshot. Produces a single standalone .db file.
  sqlite3 "$DB_PATH" ".backup '$OUT'"
  # Verify the snapshot is a valid, non-corrupt database before we keep it.
  if ! sqlite3 "$OUT" 'PRAGMA integrity_check;' | grep -q '^ok$'; then
    log "ERROR: integrity check failed on $OUT — removing bad backup"
    rm -f "$OUT"
    exit 1
  fi
else
  # Fallback: the sqlite3 CLI is not installed. Copy the db plus its WAL/SHM
  # sidecar files together so the set is internally consistent. Install the
  # sqlite3 CLI (`sudo apt install -y sqlite3`) for a cleaner single-file backup.
  log "sqlite3 CLI not found — falling back to file copy (db + -wal + -shm)"
  cp "$DB_PATH" "$OUT"
  [ -f "$DB_PATH-wal" ] && cp "$DB_PATH-wal" "$OUT-wal" || true
  [ -f "$DB_PATH-shm" ] && cp "$DB_PATH-shm" "$OUT-shm" || true
fi

gzip -f "$OUT"
[ -f "$OUT-wal" ] && gzip -f "$OUT-wal" || true
[ -f "$OUT-shm" ] && gzip -f "$OUT-shm" || true

SIZE="$(du -h "$OUT.gz" | cut -f1)"
log "Backup complete: $OUT.gz ($SIZE)"

# Retention: delete backups older than the retention window.
log "Pruning backups older than $RETENTION_DAYS days in $BACKUP_DIR"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cpcms-*.db*.gz' -mtime "+$RETENTION_DAYS" -print -delete || true

REMAINING="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cpcms-*.db.gz' | wc -l | tr -d ' ')"
log "Done. $REMAINING backup(s) retained."
