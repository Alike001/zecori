#!/bin/sh
set -eu
umask 077

archive=${1:?Usage: scripts/staging-restore-drill.sh /absolute/path/backup.tar.gz.gpg}
[ -f "$archive" ] || { echo 'Encrypted backup not found.' >&2; exit 1; }
workspace=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container=zecathon-staging-restore-drill
volume=zecathon_staging_restore_drill_data
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
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  [ "$(stat -c %a "$BACKUP_PASSPHRASE_FILE")" = 600 ] || { echo 'BACKUP_PASSPHRASE_FILE must be mode 0600.' >&2; exit 1; }
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt --output "$decrypted" "$archive"
else
  gpg --decrypt --output "$decrypted" "$archive"
fi
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
DATABASE_URL="postgresql://zecathon_staging:$password@127.0.0.1:$port/zecathon_staging_live" \
ZECATHON_ENCRYPTION_KEY_FILE="$temporary/encryption-keyring.json" \
ZECATHON_RELAY_ENCRYPTION_KEY_FILE="$temporary/relay-encryption-keyring.json" \
node --experimental-strip-types "$workspace/scripts/verify-restored-db.ts"
unset password DATABASE_URL
echo "Isolated restore drill passed. Container $container and volume $volume were retained for inspection."
echo 'No live staging container or volume was modified.'
