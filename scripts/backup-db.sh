#!/usr/bin/env bash
# backup-db.sh — hot backup of the Task Hub SQLite database while the server runs.
#
# Uses SQLite's online backup API (consistent snapshot even with an active
# WAL writer), preferring the `sqlite3` CLI `.backup` command and falling back
# to better-sqlite3's backup API when the CLI is unavailable.
#
# Usage:
#   DB_PATH=/data/tasks.db BACKUP_DIR=/data/backups scripts/backup-db.sh
#   scripts/backup-db.sh <DB_PATH> <BACKUP_DIR>
#
# Env / args:
#   DB_PATH     path to the live SQLite file (default: tasks.db)
#   BACKUP_DIR  destination directory for the backup (default: ./backups)
#
# Exit 0 on success; the backup file path is printed to stdout.
set -euo pipefail

DB_PATH="${1:-${DB_PATH:-tasks.db}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-backups}}"

if [ ! -f "$DB_PATH" ]; then
  echo "backup-db: source database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$(basename "$DB_PATH")"
DEST="$BACKUP_DIR/${BASE%.db}-$TS.db"

if command -v sqlite3 >/dev/null 2>&1; then
  # .backup runs the online backup API: a consistent snapshot without blocking
  # the live writer. Quote the dest so paths with spaces work.
  sqlite3 "$DB_PATH" ".backup '$DEST'"
else
  # Fallback: better-sqlite3's backup() (same online backup API) via the build
  # output. Requires `pnpm build` to have produced dist/db/connection.js.
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  AKA_ROOT="$ROOT" SRC_DB="$DB_PATH" OUT_DB="$DEST" node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    import { join } from "node:path";
    const { openDatabase } = await import(pathToFileURL(join(process.env.AKA_ROOT, "dist/db/connection.js")).href);
    const db = openDatabase(process.env.SRC_DB);
    await db.backup(process.env.OUT_DB);
    db.close();
  '
fi

if [ ! -s "$DEST" ]; then
  echo "backup-db: backup file missing or empty: $DEST" >&2
  exit 1
fi

echo "$DEST"
