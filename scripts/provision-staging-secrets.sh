#!/bin/sh
set -eu
umask 077

[ -t 0 ] && [ -t 1 ] || { echo 'Provisioning requires an interactive local operator terminal.' >&2; exit 1; }

workspace=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
default_dir="${XDG_CONFIG_HOME:-$HOME/.config}/zecathon-crosschain-app/staging-durable"
compose_project=zecathon-staging-durable
postgres_volume=zecathon_staging_durable_postgres_data
base_sepolia_usdc=0x036CbD53842c5426634e7929541eC2318f3dCF7e
printf 'Staging secrets directory [%s]: ' "$default_dir"
IFS= read -r secrets_dir
secrets_dir=${secrets_dir:-$default_dir}
case "$secrets_dir" in "$workspace"|"$workspace"/*) echo 'Refusing to store staging secrets inside the repository.' >&2; exit 1;; esac
case "$secrets_dir" in /*) ;; *) echo 'Secrets directory must be an absolute path.' >&2; exit 1;; esac
printf '%s' "$secrets_dir" | grep -Eq '^[A-Za-z0-9_./-]+$' || { echo 'Secrets path may contain only letters, digits, dot, underscore, slash, and hyphen.' >&2; exit 1; }

if [ -e "$secrets_dir" ] || [ -L "$secrets_dir" ]; then
  echo 'The target already exists; nothing was overwritten.' >&2
  exit 1
fi
if docker container ls -a --filter "label=com.docker.compose.project=$compose_project" --format '{{.Names}}' | grep -q .; then
  echo "Compose project $compose_project already has containers; nothing was changed." >&2
  exit 1
fi
if docker volume inspect "$postgres_volume" >/dev/null 2>&1; then
  echo "PostgreSQL volume $postgres_volume already exists; nothing was changed." >&2
  exit 1
fi

printf 'Staging operator ID [staging-operator]: '
IFS= read -r operator_id
operator_id=${operator_id:-staging-operator}
printf '%s' "$operator_id" | grep -Eq '^[A-Za-z0-9._-]{3,64}$' || { echo 'Operator ID must be 3-64 letters, digits, dot, underscore, or hyphen.' >&2; exit 1; }
printf 'Type "CONFIRM BASE-SEPOLIA 84532" to create new staging-only credentials: '
IFS= read -r confirmation
[ "$confirmation" = 'CONFIRM BASE-SEPOLIA 84532' ] || { echo 'Provisioning cancelled.' >&2; exit 1; }

mkdir -p "$(dirname -- "$secrets_dir")"
mkdir "$secrets_dir"
chmod 0700 "$secrets_dir"
openssl rand -hex 32 > "$secrets_dir/db_password"
openssl rand 32 > "$secrets_dir/operator-hmac.key"
openssl rand -base64 48 > "$secrets_dir/backup-passphrase"
order_key=$(openssl rand -base64 32 | tr -d '\n')
relay_key=$(openssl rand -base64 32 | tr -d '\n')
printf '{"activeVersion":1,"keys":{"1":"%s"}}\n' "$order_key" > "$secrets_dir/encryption-keyring.json"
printf '{"activeVersion":1,"keys":{"1":"%s"}}\n' "$relay_key" > "$secrets_dir/relay-encryption-keyring.json"
unset order_key relay_key
openssl genpkey -algorithm Ed25519 -out "$secrets_dir/relay-coordinator-private.pem" 2>/dev/null
openssl pkey -in "$secrets_dir/relay-coordinator-private.pem" -pubout -out "$secrets_dir/relay-coordinator-public.pem" 2>/dev/null
openssl genpkey -algorithm Ed25519 -out "$secrets_dir/relay-verifier-private.pem" 2>/dev/null
openssl pkey -in "$secrets_dir/relay-verifier-private.pem" -pubout -out "$secrets_dir/relay-verifier-public.pem" 2>/dev/null
chmod 0600 "$secrets_dir"/*
cat > "$secrets_dir/staging.env" <<EOF
STAGING_SECRETS_DIR=$secrets_dir
STAGING_COMPOSE_PROJECT=$compose_project
STAGING_POSTGRES_VOLUME=$postgres_volume
STAGING_DATASET_ID=durable-staging-v1
BASE_SEPOLIA_CHAIN_ID=84532
BASE_SEPOLIA_USDC=$base_sepolia_usdc
ZECATHON_OPERATOR_ID=$operator_id
ZECATHON_RELAY_VERIFIER_ID=staging-verifier
STAGING_RUNTIME_UID=$(id -u)
STAGING_RUNTIME_GID=$(id -g)
BACKUP_PASSPHRASE_FILE=$secrets_dir/backup-passphrase
EOF
chmod 0600 "$secrets_dir/staging.env"
echo "Durable staging secrets provisioned outside the repository with mode 0600 files. Values were not printed."
echo "Environment file: $secrets_dir/staging.env"
