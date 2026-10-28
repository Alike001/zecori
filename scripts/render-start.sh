#!/bin/sh
set -eu
umask 077

fail() {
  echo "Render judge startup refused: $1" >&2
  exit 1
}

[ "${ZECORI_DEPLOYMENT_KIND:-}" = "public-judge-demo" ] || fail "ZECORI_DEPLOYMENT_KIND must identify the isolated public judge demo."
[ "${NODE_ENV:-}" = "production" ] || fail "NODE_ENV must be production."
[ "${HOST:-}" = "0.0.0.0" ] || fail "HOST must be 0.0.0.0."
[ "${TRUST_PROXY:-}" = "1" ] || fail "TRUST_PROXY must be 1."
[ "${PUBLIC_ORIGIN:-}" = "https://zecori.iamalikex.tech" ] || fail "PUBLIC_ORIGIN must be the final HTTPS judge origin."
[ "${WEBAUTHN_RP_ID:-}" = "zecori.iamalikex.tech" ] || fail "WEBAUTHN_RP_ID must be the final judge hostname."
[ "${ZECATHON_ROUTE_REQUESTS_ENABLED:-0}" = "0" ] || fail "route requests must remain disabled in the judge demo."
[ "${ZECATHON_ROUTE_LIQUIDITY_READY:-0}" = "0" ] || fail "route liquidity must remain disabled in the judge demo."
[ "${ZECATHON_ERC1271_ENABLED:-0}" = "0" ] || fail "contract-wallet verification is outside this judge release."
[ "${PRIVY_AUTH_ENABLED:-0}" = "0" ] || fail "Privy remains disabled in this judge release."
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is missing."

case "$DATABASE_URL" in
  *"sslmode=require"*|*"sslmode=verify-full"*) ;;
  *) fail "DATABASE_URL must require TLS." ;;
esac

[ "${ZECATHON_TEST_VARIABLE_QUOTES_ENABLED:-0}" = "0" ] || fail "variable financial requests must remain disabled."
[ -z "${ZECORI_PRIVATE_REQUEST_WINDOW_FILE:-}" ] || fail "private request windows are forbidden on the public service."
[ -z "${ZECORI_OPERATOR_DATABASE_URL:-}" ] || fail "private operator configuration is forbidden on the public service."
[ -z "${ZECORI_OPERATOR_LOGIN_TOKEN_FILE:-}" ] || fail "private operator credentials are forbidden on the public service."
[ -z "${ZECORI_OPERATOR_APPROVED_PACKET:-}" ] || fail "private payout approvals are forbidden on the public service."
node --experimental-strip-types scripts/verify-public-schema.ts
exec node --experimental-strip-types server/app-server.ts
