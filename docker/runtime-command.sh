#!/bin/sh
set -eu
umask 077

: "${DB_PASSWORD_FILE:?DB_PASSWORD_FILE is required}"
: "${DB_HOST:?DB_HOST is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
: "${ZECATHON_ENCRYPTION_KEY_FILE:?ZECATHON_ENCRYPTION_KEY_FILE is required}"
[ -r "$DB_PASSWORD_FILE" ] || { echo 'Database password secret is not readable.' >&2; exit 1; }
[ -r "$ZECATHON_ENCRYPTION_KEY_FILE" ] || { echo 'Encryption keyring secret is not readable.' >&2; exit 1; }
[ "$#" -gt 0 ] || { echo 'A runtime command is required.' >&2; exit 1; }

database_password=$(cat "$DB_PASSWORD_FILE")
[ -n "$database_password" ] || { echo 'Database password secret is empty.' >&2; exit 1; }
export DATABASE_URL="postgresql://$DB_USER:$database_password@$DB_HOST:${DB_PORT:-5432}/$DB_NAME"
unset database_password
exec "$@"
