#!/bin/sh
set -eu
umask 077

private_dir=/tmp/zecathon-runtime-secrets
mkdir -p "$private_dir"
chmod 0700 "$private_dir"

materialize_secret() {
  variable=$1
  target=$2
  eval "source_path=\${$variable:-}"
  if [ -n "$source_path" ]; then
    cp "$source_path" "$private_dir/$target"
    chmod 0400 "$private_dir/$target"
    eval "export $variable=$private_dir/$target"
  fi
}

if [ -n "${DB_PASSWORD_FILE:-}" ]; then
  DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"
  export DATABASE_URL="postgresql://${DB_USER:-zecathon}:${DB_PASSWORD}@${DB_HOST:-postgres}:${DB_PORT:-5432}/${DB_NAME:-zecathon}"
  unset DB_PASSWORD
fi

materialize_secret ZECATHON_ENCRYPTION_KEY_FILE encryption-keyring.json
materialize_secret ZECATHON_RELAY_ENCRYPTION_KEY_FILE relay-encryption-keyring.json
materialize_secret ZECATHON_OPERATOR_KEY operator-hmac.key
materialize_secret ZECATHON_RELAY_COORDINATOR_PRIVATE_KEY_FILE relay-coordinator-private.pem
materialize_secret ZECATHON_RELAY_COORDINATOR_PUBLIC_KEY_FILE relay-coordinator-public.pem
materialize_secret ZECATHON_RELAY_VERIFIER_PRIVATE_KEY_FILE relay-verifier-private.pem
materialize_secret ZECATHON_RELAY_VERIFIER_PUBLIC_KEY_FILE relay-verifier-public.pem
if [ "$(id -u)" -eq 0 ]; then
  chown -R 10001:10001 "$private_dir"
  exec setpriv --reuid=10001 --regid=10001 --init-groups "$@"
fi
exec "$@"
