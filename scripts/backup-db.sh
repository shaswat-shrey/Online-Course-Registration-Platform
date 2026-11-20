#!/usr/bin/env sh
# Nightly PostgreSQL backup (docs/DEPLOYMENT.md §5).
#   DATABASE_URL=postgresql://… BACKUP_DIR=/var/backups/ucrams KEEP_DAYS=30 scripts/backup-db.sh
# Writes a compressed custom-format dump and removes dumps older than KEEP_DAYS.
# Copy BACKUP_DIR off the host (object storage) from your scheduler afterwards.
set -eu

: "${DATABASE_URL:?Set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%d-%H%M)"
FILE="$BACKUP_DIR/ucrams-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$FILE.partial"
mv "$FILE.partial" "$FILE"
pg_restore --list "$FILE" > /dev/null   # fails if the dump is unreadable
find "$BACKUP_DIR" -name 'ucrams-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $FILE"
