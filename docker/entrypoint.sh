#!/bin/sh
set -eu

if [ -n "${DB_PASSWORD_FILE:-}" ]; then
  DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"
  export DATABASE_URL="postgresql://${DB_USER:-zecathon}:${DB_PASSWORD}@${DB_HOST:-postgres}:${DB_PORT:-5432}/${DB_NAME:-zecathon}"
  unset DB_PASSWORD
fi

exec "$@"
