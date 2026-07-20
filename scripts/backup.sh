#!/usr/bin/env bash
#
# A17 — nightly backup, per tech.md 3: an online copy of the SQLite database, an archive of
# /var/lib/marzban, and fourteen days of rotation.
#
# Runs on the HOST from cron (see scripts/backup.cron.example), not inside a container: the point of
# a backup is to survive the thing being backed up, and a job living in the app container dies with
# it. Docker is used only to locate the volumes.
#
# ## Why sqlite3 .backup and never cp
#
# The app is running while this executes and SQLite is in WAL mode (tech.md 5). A plain copy of
# app.db captures a file whose committed data is partly in app.db-wal, and restoring it silently
# loses whatever had not been checkpointed — orders and subscriptions among them. `.backup` uses the
# online backup API: it takes the same locks the database does and produces a consistent single file
# with the WAL already folded in.
#
# Usage: backup.sh [destination]   (default /var/backups/vpn-service)

set -euo pipefail

BACKUP_DIR="${1:-/var/backups/vpn-service}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%F)"

# Compose prefixes volumes with the project name, which docker-compose.yml pins to `vpn-service`.
PROJECT="${COMPOSE_PROJECT_NAME:-vpn-service}"
APP_VOLUME="${PROJECT}_app-data"
MARZBAN_VOLUME="${PROJECT}_marzban-data"

die() {
	echo "backup: $*" >&2
	exit 1
}

need() {
	command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"
}

need docker
need sqlite3
need tar

# Resolves a named volume to its path on the host. A missing volume is fatal rather than skipped:
# a backup run that quietly archives nothing is worse than one that fails loudly.
volume_path() {
	local name="$1" path
	path="$(docker volume inspect --format '{{ .Mountpoint }}' "$name" 2>/dev/null)" ||
		die "volume $name not found — is the stack up, and is COMPOSE_PROJECT_NAME right?"
	[ -d "$path" ] || die "volume $name resolves to $path, which is not a directory"
	printf '%s' "$path"
}

mkdir -p "$BACKUP_DIR"
# The database holds session material and the Marzban archive holds proxy credentials. Neither has
# any business being world-readable, and umask must be set before the first file is created.
chmod 700 "$BACKUP_DIR"
umask 077

APP_DB="$(volume_path "$APP_VOLUME")/app.db"
[ -f "$APP_DB" ] || die "no database at $APP_DB"

DB_OUT="$BACKUP_DIR/app-$STAMP.db"

# Written to a temporary name and moved into place only on success, so an interrupted run never
# leaves a truncated file wearing today's date — the one a restore would reach for first.
sqlite3 "$APP_DB" ".backup '$DB_OUT.partial'"

# The copy inherits WAL from the source, so every connection that opens it — including the integrity
# check on the next line — lays a -wal and a -shm beside it and leaves them there. They match none of
# the rotation globs below, so they would pile up forever looking like part of a backup.
#
# Switching the COPY to DELETE mode folds the WAL into the file and drops the sidecars, which is what
# a backup should be anyway: one self-contained file that restores by being moved into place. The
# live database is untouched and stays in WAL.
#
# The result is read through `tail` rather than `grep -q`, which exits on its first match and
# SIGPIPEs sqlite3 mid-shutdown.
integrity="$(sqlite3 "$DB_OUT.partial" 'PRAGMA journal_mode=DELETE; PRAGMA integrity_check;' |
	tail -n 1)"
[ "$integrity" = 'ok' ] ||
	die "integrity check failed on the fresh copy — keeping $DB_OUT.partial for inspection"

# Belt and braces: whether sqlite unlinks the sidecars on close is version-dependent, and the DELETE
# switch above has been observed to leave the -shm behind. No connection is open by now, and the
# checkpoint has already happened, so removing them by hand is safe and makes the result the same
# everywhere this runs.
rm -f "$DB_OUT.partial-wal" "$DB_OUT.partial-shm"

mv "$DB_OUT.partial" "$DB_OUT"

MARZBAN_PATH="$(volume_path "$MARZBAN_VOLUME")"
MARZBAN_OUT="$BACKUP_DIR/marzban-$STAMP.tar.gz"

tar -czf "$MARZBAN_OUT.partial" -C "$MARZBAN_PATH" .
mv "$MARZBAN_OUT.partial" "$MARZBAN_OUT"

# tech.md 3: fourteen days. Only this script's own artefacts are matched — a stray file in the
# directory is somebody else's and is not this script's to delete.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'app-*.db' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'marzban-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "backup: wrote $DB_OUT and $MARZBAN_OUT, kept $KEEP_DAYS days"
