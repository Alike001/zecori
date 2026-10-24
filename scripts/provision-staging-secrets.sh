#!/bin/sh
set -eu
umask 077

workspace=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
default_dir="${XDG_CONFIG_HOME:-$HOME/.config}/zecathon-crosschain-app/staging"
printf 'Staging secrets directory [%s]: ' "$default_dir"
IFS= read -r secrets_dir
secrets_dir=${secrets_dir:-$default_dir}
case "$secrets_dir" in "$workspace"|"$workspace"/*) echo 'Refusing to store staging secrets inside the repository.' >&2; exit 1;; esac
printf '%s' "$secrets_dir" | grep -Eq '^[A-Za-z0-9_./-]+$' || { echo 'Secrets path may contain only letters, digits, dot, underscore, slash, and hyphen.' >&2; exit 1; }

if [ -d "$secrets_dir" ] && [ -n "$(find "$secrets_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "The target already contains files; nothing was overwritten:" >&2
  find "$secrets_dir" -mindepth 1 -maxdepth 1 -printf '  %f\n' >&2
  exit 1
fi

printf 'Confirmed Base Sepolia test-USDC receiver (0x + 40 hex): '
IFS= read -r receiver
case "$receiver" in 0x????????????????????????????????????????) ;; *) echo 'Receiver format is invalid.' >&2; exit 1;; esac
if ! printf '%s' "$receiver" | grep -Eq '^0x[0-9A-Fa-f]{40}$' || printf '%s' "$receiver" | grep -Eq '^0x0{40}$'; then echo 'Receiver must be a complete non-zero address.' >&2; exit 1; fi
printf 'Staging operator ID [staging-operator]: '
IFS= read -r operator_id
operator_id=${operator_id:-staging-operator}
printf '%s' "$operator_id" | grep -Eq '^[A-Za-z0-9._-]{3,64}$' || { echo 'Operator ID must be 3-64 letters, digits, dot, underscore, or hyphen.' >&2; exit 1; }
printf 'Type STAGING-ONLY to confirm these keys are new and will not be reused: '
IFS= read -r confirmation
[ "$confirmation" = 'STAGING-ONLY' ] || { echo 'Provisioning cancelled.' >&2; exit 1; }

mkdir -p "$secrets_dir"
chmod 0700 "$secrets_dir"
openssl rand -hex 32 > "$secrets_dir/db_password"
openssl rand 32 > "$secrets_dir/operator-hmac.key"
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
ROUTE_DESTINATION_RECIPIENT=$receiver
ZECATHON_OPERATOR_ID=$operator_id
ZECATHON_RELAY_VERIFIER_ID=staging-verifier
STAGING_RUNTIME_UID=$(id -u)
STAGING_RUNTIME_GID=$(id -g)
EOF
chmod 0600 "$secrets_dir/staging.env"
echo "Staging secrets provisioned outside the repository with mode 0600 files. Values were not printed."
echo "Environment file: $secrets_dir/staging.env"
