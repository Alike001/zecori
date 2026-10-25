#!/bin/sh
set -eu
umask 077

archive=${1:?Usage: scripts/staging-restore-drill.sh /absolute/path/backup.tar.gz.gpg /absolute/path/staging.env}
env_file=${2:?Usage: scripts/staging-restore-drill.sh /absolute/path/backup.tar.gz.gpg /absolute/path/staging.env}
case "$archive" in /*) ;; *) echo 'Encrypted backup path must be absolute.' >&2; exit 1;; esac
case "$env_file" in /*) ;; *) echo 'Staging environment file must be absolute.' >&2; exit 1;; esac
[ -f "$archive" ] || { echo 'Encrypted backup not found.' >&2; exit 1; }
[ -f "$archive.sha256" ] || { echo 'Encrypted backup checksum not found.' >&2; exit 1; }
[ -f "$env_file" ] || { echo 'Staging environment file not found.' >&2; exit 1; }
[ ! -L "$env_file" ] || { echo 'Staging environment file must not be a symlink.' >&2; exit 1; }
[ "$(stat -c %a "$env_file")" = 600 ] || { echo 'Staging environment file must be mode 0600.' >&2; exit 1; }
[ "$(stat -c %u "$env_file")" = "$(id -u)" ] || { echo 'Staging environment file must be owned by the current operator.' >&2; exit 1; }
. "$env_file"
: "${BACKUP_PASSPHRASE_FILE:?Missing BACKUP_PASSPHRASE_FILE}"
[ -f "$BACKUP_PASSPHRASE_FILE" ] || { echo 'Backup passphrase file not found.' >&2; exit 1; }
[ "$(stat -c %a "$BACKUP_PASSPHRASE_FILE")" = 600 ] || { echo 'BACKUP_PASSPHRASE_FILE must be mode 0600.' >&2; exit 1; }
(cd "$(dirname -- "$archive")" && sha256sum -c "$(basename -- "$archive").sha256")
workspace=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
drill_id=${RESTORE_DRILL_ID:-${STAGING_COMPOSE_PROJECT:-zecathon-staging}-restore-drill}
printf '%s' "$drill_id" | grep -Eq '^[a-z0-9][a-z0-9_-]{2,62}$' || { echo 'Restore drill ID is invalid.' >&2; exit 1; }
container=$drill_id
volume=$(printf '%s_data' "$drill_id" | tr '-' '_')
existing=0
if docker container inspect "$container" >/dev/null 2>&1 || docker volume inspect "$volume" >/dev/null 2>&1; then
  if [ "${RESTORE_DRILL_RESUME:-0}" != 1 ] || ! docker container inspect "$container" >/dev/null 2>&1 || ! docker volume inspect "$volume" >/dev/null 2>&1; then
    echo 'The isolated restore drill container or volume already exists. Nothing was changed.' >&2
    echo 'Inspect it and obtain approval before removing it, or set RESTORE_DRILL_RESUME=1 only for an inspected empty failed drill.' >&2
    exit 1
  fi
  existing=1
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/zecathon-staging-restore.XXXXXX")
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
chmod 0700 "$temporary"
listing="$temporary/archive.list"
decrypted="$temporary/backup.tar.gz"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt --output "$decrypted" "$archive"
tar -tzf "$decrypted" > "$listing"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$listing"; then echo 'Unsafe path in backup archive.' >&2; exit 1; fi
tar -xzf "$decrypted" -C "$temporary"
rm -f "$decrypted"
(cd "$temporary" && sha256sum -c SHA256SUMS)
chmod 0700 "$temporary"; chmod 0600 "$temporary"/*

if [ "$existing" -eq 0 ]; then
  docker volume create "$volume" >/dev/null
  docker run -d --name "$container" --restart=no -p 127.0.0.1::5432 \
    -e POSTGRES_DB=zecathon_staging_live -e POSTGRES_USER=zecathon_staging -e POSTGRES_PASSWORD_FILE=/run/secrets/db_password \
    -v "$volume:/var/lib/postgresql/data" -v "$temporary/db_password:/run/secrets/db_password:ro" postgres:17.7-alpine >/dev/null
fi
attempt=0
until [ "$(docker exec "$container" psql -U zecathon_staging -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname='zecathon_staging_live'" 2>/dev/null || true)" = 1 ] \
  && docker exec "$container" psql -U zecathon_staging -d zecathon_staging_live -Atc 'SELECT 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 30 ] || { echo 'Restore PostgreSQL did not become ready.' >&2; exit 1; }; sleep 1
done
tables=$(docker exec "$container" psql -U zecathon_staging -d zecathon_staging_live -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
[ "$tables" = 0 ] || { echo 'Restore target is not empty; refusing to overwrite it.' >&2; exit 1; }
docker exec -i "$container" pg_restore -U zecathon_staging -d zecathon_staging_live --no-owner --no-acl < "$temporary/database.dump"
port=$(docker port "$container" 5432/tcp | sed -n 's/^127\.0\.0\.1://p')
password=$(tr -d '\r\n' < "$temporary/db_password")
before_restart=$(DATABASE_URL="postgresql://zecathon_staging:$password@127.0.0.1:$port/zecathon_staging_live" \
ZECATHON_ENCRYPTION_KEY_FILE="$temporary/encryption-keyring.json" \
ZECATHON_RELAY_ENCRYPTION_KEY_FILE="$temporary/relay-encryption-keyring.json" \
node --experimental-strip-types "$workspace/scripts/verify-restored-db.ts")
printf '%s\n' "$before_restart"
printf '%s\n' "$before_restart" > "$temporary/before-restart-inventory.json"
docker restart "$container" >/dev/null
attempt=0
until docker exec "$container" psql -U zecathon_staging -d zecathon_staging_live -Atc 'SELECT 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 30 ] || { echo 'Restored PostgreSQL did not recover after restart.' >&2; exit 1; }; sleep 1
done

# Docker may reassign the published port after a restart.
# Re-discover the loopback port before verifying recovery.
port=$(docker port "$container" 5432/tcp | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p')

case "$port" in
  ''|*[!0-9]*)
    echo "Invalid or unavailable PostgreSQL loopback port" >&2
    exit 1
    ;;
esac

echo "Post-restart PostgreSQL port detected."

after_restart=$(DATABASE_URL="postgresql://zecathon_staging:$password@127.0.0.1:$port/zecathon_staging_live" \
ZECATHON_ENCRYPTION_KEY_FILE="$temporary/encryption-keyring.json" \
ZECATHON_RELAY_ENCRYPTION_KEY_FILE="$temporary/relay-encryption-keyring.json" \
node --experimental-strip-types "$workspace/scripts/verify-restored-db.ts")

printf '%s\n' "$after_restart"
printf '%s\n' "$after_restart" > "$temporary/after-restart-inventory.json"
node --experimental-strip-types "$workspace/scripts/compare-recovery-inventory.ts" \
  "$temporary/before-restart-inventory.json" "$temporary/after-restart-inventory.json"
unset password DATABASE_URL
echo "Isolated restore and restart drill passed. Container $container and volume $volume were retained for inspection."
echo 'No live staging container or volume was modified.'
