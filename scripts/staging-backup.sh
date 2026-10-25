#!/bin/sh
set -eu
umask 077

env_file=${1:?Usage: scripts/staging-backup.sh /absolute/path/staging.env [backup-directory]}
case "$env_file" in /*) ;; *) echo 'Staging environment file must be an absolute path.' >&2; exit 1;; esac
[ -f "$env_file" ] || { echo 'Staging environment file not found.' >&2; exit 1; }
[ ! -L "$env_file" ] || { echo 'Staging environment file must not be a symlink.' >&2; exit 1; }
[ "$(stat -c %a "$env_file")" = 600 ] || { echo 'Staging environment file must be mode 0600.' >&2; exit 1; }
[ "$(stat -c %u "$env_file")" = "$(id -u)" ] || { echo 'Staging environment file must be owned by the current operator.' >&2; exit 1; }
# The provisioner creates this mode-0600 file and it contains only paths and public configuration.
. "$env_file"
: "${STAGING_SECRETS_DIR:?Missing STAGING_SECRETS_DIR}"
: "${STAGING_COMPOSE_PROJECT:?Missing STAGING_COMPOSE_PROJECT}"
: "${STAGING_POSTGRES_VOLUME:?Missing STAGING_POSTGRES_VOLUME}"
: "${BACKUP_PASSPHRASE_FILE:?Missing BACKUP_PASSPHRASE_FILE}"
[ "$STAGING_POSTGRES_VOLUME" != zecathon_staging_postgres_data ] || { echo 'Refusing to back up the legacy temporary staging dataset as durable staging.' >&2; exit 1; }
[ -f "$BACKUP_PASSPHRASE_FILE" ] || { echo 'Backup passphrase file not found.' >&2; exit 1; }
[ "$(stat -c %a "$BACKUP_PASSPHRASE_FILE")" = 600 ] || { echo 'BACKUP_PASSPHRASE_FILE must be mode 0600.' >&2; exit 1; }
workspace=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir=${2:-"${XDG_DATA_HOME:-$HOME/.local/share}/zecathon-crosschain-app/staging-backups"}
case "$backup_dir" in /*) ;; *) echo 'Backup directory must be an absolute path.' >&2; exit 1;; esac
case "$backup_dir" in "$workspace"|"$workspace"/*) echo 'Backups must remain outside the repository.' >&2; exit 1;; esac
docker compose --env-file "$env_file" -f "$workspace/compose.staging.yaml" exec -T api \
  zecathon-runtime-command node --experimental-strip-types scripts/verify-backup-source.ts
mkdir -p "$backup_dir"; chmod 0700 "$backup_dir"
temporary=$(mktemp -d "${TMPDIR:-/tmp}/zecathon-staging-backup.XXXXXX")
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
chmod 0700 "$temporary"

docker compose --env-file "$env_file" -f "$workspace/compose.staging.yaml" exec -T postgres pg_dump -U zecathon_staging -d zecathon_staging_live --format=custom --no-owner --no-acl > "$temporary/database.dump"
docker compose --env-file "$env_file" -f "$workspace/compose.staging.yaml" exec -T postgres psql -U zecathon_staging -d zecathon_staging_live -Atc "SELECT version FROM schema_migrations ORDER BY version" > "$temporary/migrations.txt"
for file in db_password encryption-keyring.json relay-encryption-keyring.json operator-hmac.key relay-coordinator-private.pem relay-coordinator-public.pem relay-verifier-private.pem relay-verifier-public.pem; do
  [ -f "$STAGING_SECRETS_DIR/$file" ] || { echo "Required staging secret is missing: $file" >&2; exit 1; }
  cp "$STAGING_SECRETS_DIR/$file" "$temporary/$file"
done
cp "$env_file" "$temporary/staging.env"
chmod 0600 "$temporary"/*
(cd "$temporary" && sha256sum database.dump migrations.txt staging.env db_password encryption-keyring.json relay-encryption-keyring.json operator-hmac.key relay-*.pem > SHA256SUMS)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$backup_dir/zecathon-staging-$timestamp.tar.gz.gpg"
[ ! -e "$output" ] || { echo 'Backup target already exists; refusing overwrite.' >&2; exit 1; }
tar -C "$temporary" -czf - . | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --symmetric --cipher-algo AES256 --output "$output"
chmod 0600 "$output"
(cd "$backup_dir" && sha256sum "$(basename -- "$output")" > "$(basename -- "$output").sha256")
chmod 0600 "$output.sha256"
echo "Encrypted staging backup created: $output"
echo "Encrypted archive checksum created: $output.sha256"
echo 'Run the isolated restore drill before allowing funded testnet orders.'
