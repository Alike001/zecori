#!/bin/sh
set -eu
umask 077

env_file=${1:?Usage: scripts/staging-durable-check.sh /absolute/path/staging.env}
case "$env_file" in /*) ;; *) echo 'Staging environment file must be an absolute path.' >&2; exit 1;; esac
[ -f "$env_file" ] || { echo 'Staging environment file not found.' >&2; exit 1; }
[ ! -L "$env_file" ] || { echo 'Staging environment file must not be a symlink.' >&2; exit 1; }
[ "$(stat -c %a "$env_file")" = 600 ] || { echo 'Staging environment file must be mode 0600.' >&2; exit 1; }
[ "$(stat -c %u "$env_file")" = "$(id -u)" ] || { echo 'Staging environment file must be owned by the current operator.' >&2; exit 1; }
. "$env_file"

workspace=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "${STAGING_SECRETS_DIR:?Missing STAGING_SECRETS_DIR}"
: "${STAGING_COMPOSE_PROJECT:?Missing STAGING_COMPOSE_PROJECT}"
: "${STAGING_POSTGRES_VOLUME:?Missing STAGING_POSTGRES_VOLUME}"
: "${STAGING_DATASET_ID:?Missing STAGING_DATASET_ID}"
: "${BASE_SEPOLIA_CHAIN_ID:?Missing BASE_SEPOLIA_CHAIN_ID}"
: "${BASE_SEPOLIA_USDC:?Missing BASE_SEPOLIA_USDC}"
: "${BACKUP_PASSPHRASE_FILE:?Missing BACKUP_PASSPHRASE_FILE}"

[ "$STAGING_COMPOSE_PROJECT" = zecathon-staging-durable ] || { echo 'Unexpected durable Compose project name.' >&2; exit 1; }
[ "$STAGING_POSTGRES_VOLUME" = zecathon_staging_durable_postgres_data ] || { echo 'Unexpected durable PostgreSQL volume name.' >&2; exit 1; }
[ "$STAGING_DATASET_ID" = durable-staging-v1 ] || { echo 'Unexpected staging dataset identity.' >&2; exit 1; }
[ "$STAGING_POSTGRES_VOLUME" != zecathon_staging_postgres_data ] || { echo 'Legacy temporary PostgreSQL volume cannot be reused.' >&2; exit 1; }
[ "$BASE_SEPOLIA_CHAIN_ID" = 84532 ] || { echo 'Unexpected Base Sepolia chain ID.' >&2; exit 1; }
[ "$BASE_SEPOLIA_USDC" = 0x036CbD53842c5426634e7929541eC2318f3dCF7e ] || { echo 'Unexpected Circle test-USDC contract.' >&2; exit 1; }
case "$STAGING_SECRETS_DIR" in "$workspace"|"$workspace"/*) echo 'Secrets directory is inside the repository.' >&2; exit 1;; esac
[ -d "$STAGING_SECRETS_DIR" ] && [ ! -L "$STAGING_SECRETS_DIR" ] || { echo 'Secrets directory must be a real directory.' >&2; exit 1; }
[ "$(stat -c %a "$STAGING_SECRETS_DIR")" = 700 ] || { echo 'Secrets directory must be mode 0700.' >&2; exit 1; }
[ "$(stat -c %u "$STAGING_SECRETS_DIR")" = "$(id -u)" ] || { echo 'Secrets directory must be owned by the current operator.' >&2; exit 1; }

required='db_password encryption-keyring.json relay-encryption-keyring.json operator-hmac.key relay-coordinator-private.pem relay-coordinator-public.pem relay-verifier-private.pem relay-verifier-public.pem backup-passphrase staging.env'
for file in $required; do
  path=$STAGING_SECRETS_DIR/$file
  [ -f "$path" ] && [ ! -L "$path" ] || { echo "Required secret file is missing or unsafe: $file" >&2; exit 1; }
  [ "$(stat -c %a "$path")" = 600 ] || { echo "Secret file must be mode 0600: $file" >&2; exit 1; }
  [ "$(stat -c %u "$path")" = "$(id -u)" ] || { echo "Secret file has the wrong owner: $file" >&2; exit 1; }
done
[ "$BACKUP_PASSPHRASE_FILE" = "$STAGING_SECRETS_DIR/backup-passphrase" ] || { echo 'Backup credential path is not the provisioned dedicated file.' >&2; exit 1; }
[ "$(wc -c < "$STAGING_SECRETS_DIR/db_password")" -ge 64 ] || { echo 'Database credential is too short.' >&2; exit 1; }
[ "$(wc -c < "$STAGING_SECRETS_DIR/operator-hmac.key")" -ge 32 ] || { echo 'Operator authorization key is too short.' >&2; exit 1; }

node - "$STAGING_SECRETS_DIR/encryption-keyring.json" "$STAGING_SECRETS_DIR/relay-encryption-keyring.json" <<'NODE'
const fs = require('node:fs');
for (const path of process.argv.slice(2)) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (value.activeVersion !== 1 || Object.keys(value.keys ?? {}).join(',') !== '1') throw new Error('Keyring must explicitly start at active version 1');
  const key = Buffer.from(value.keys['1'], 'base64');
  if (key.length !== 32) throw new Error('Keyring version 1 must contain 32 random bytes');
}
NODE

temporary=$(mktemp -d "${TMPDIR:-/tmp}/zecathon-key-check.XXXXXX")
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
chmod 0700 "$temporary"
openssl pkey -in "$STAGING_SECRETS_DIR/relay-coordinator-private.pem" -pubout -out "$temporary/coordinator.pem" 2>/dev/null
openssl pkey -in "$STAGING_SECRETS_DIR/relay-verifier-private.pem" -pubout -out "$temporary/verifier.pem" 2>/dev/null
cmp -s "$temporary/coordinator.pem" "$STAGING_SECRETS_DIR/relay-coordinator-public.pem" || { echo 'Coordinator relay identity pair does not match.' >&2; exit 1; }
cmp -s "$temporary/verifier.pem" "$STAGING_SECRETS_DIR/relay-verifier-public.pem" || { echo 'Verifier relay identity pair does not match.' >&2; exit 1; }

if find "$STAGING_SECRETS_DIR" -maxdepth 1 \( -name '*.seed' -o -name '*.mnemonic' -o -name 'keys.toml' -o -name 'wallet.dat' \) -print -quit | grep -q .; then
  echo 'Wallet key material must not be stored in the staging secrets directory.' >&2
  exit 1
fi

docker compose --env-file "$env_file" -f "$workspace/compose.staging.yaml" config --quiet
printf '%s\n' '{"status":"DURABLE_STAGING_CONFIGURATION_VERIFIED","project":"zecathon-staging-durable","volume":"zecathon_staging_durable_postgres_data","dataset":"durable-staging-v1","recipient":"0xAc3672B0f6134119d61b7222752B671CC392173F","chainId":84532,"usdc":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","keyringVersion":1,"secretValuesPrinted":false}'
