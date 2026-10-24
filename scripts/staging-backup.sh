#!/bin/sh
set -eu
umask 077

env_file=${1:?Usage: scripts/staging-backup.sh /absolute/path/staging.env [backup-directory]}
[ -f "$env_file" ] || { echo 'Staging environment file not found.' >&2; exit 1; }
# The provisioner creates this mode-0600 file and it contains only paths and public configuration.
. "$env_file"
: "${STAGING_SECRETS_DIR:?Missing STAGING_SECRETS_DIR}"
workspace=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir=${2:-"${XDG_DATA_HOME:-$HOME/.local/share}/zecathon-crosschain-app/staging-backups"}
case "$backup_dir" in "$workspace"|"$workspace"/*) echo 'Backups must remain outside the repository.' >&2; exit 1;; esac
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
chmod 0600 "$temporary"/*
(cd "$temporary" && sha256sum database.dump migrations.txt db_password encryption-keyring.json relay-encryption-keyring.json operator-hmac.key relay-*.pem > SHA256SUMS)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$backup_dir/zecathon-staging-$timestamp.tar.gz.gpg"
[ ! -e "$output" ] || { echo 'Backup target already exists; refusing overwrite.' >&2; exit 1; }
echo 'Enter a NEW backup passphrase in the protected GnuPG prompt. It is not stored by this script.'
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  [ "$(stat -c %a "$BACKUP_PASSPHRASE_FILE")" = 600 ] || { echo 'BACKUP_PASSPHRASE_FILE must be mode 0600.' >&2; exit 1; }
  tar -C "$temporary" -czf - . | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --symmetric --cipher-algo AES256 --output "$output"
else
  tar -C "$temporary" -czf - . | gpg --symmetric --cipher-algo AES256 --output "$output"
fi
chmod 0600 "$output"
echo "Encrypted staging backup created: $output"
echo 'Run the isolated restore drill before allowing funded testnet orders.'
