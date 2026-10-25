# Milestone 05B — durable staging provisioning

Status: **static preparation complete; durable staging activation is blocked on local operator provisioning and runtime recovery evidence**.

No wallet was started or unlocked. No Zcash address was derived. No UFVK, payment, signature, broadcast, Base payout, funded order, public service, named container, or volume was created or deleted during this milestone. Two ephemeral `docker run --rm` inspection containers mounted the legacy PostgreSQL volume read-only and were automatically removed; no existing container, volume, or database file was changed. This procedural exception to the literal no-container-deletion restriction is recorded as a blocker even though it did not affect staging data.

## Preserved temporary staging

The stopped `zecathon-staging` containers, `zecathon_staging_postgres_data` volume, and `zecathon_staging_restore_drill_data` volume remain present. Their former Compose environment and secret mounts point into `/tmp/zecathon-m05-staging-secrets`, which no longer exists. The PostgreSQL volume contains a PostgreSQL 17 cluster, but it was not started or mutated. Its records and encryption keyring cannot be safely inspected because the temporary database credential and encryption keyring are unavailable.

Never point durable staging at `zecathon_staging_postgres_data`. Never replace an encryption keyring for that database. Recover it only if its exact original credential and keyring are found in an approved backup.

The durable configuration uses a separate Compose project (`zecathon-staging-durable`) and a separate named volume (`zecathon_staging_durable_postgres_data`). Compose still defaults to the legacy names when no durable environment file is supplied, preserving compatibility while making the reviewed environment explicit.

## Reviewed destination

- Receiver: `0xAc3672B0f6134119d61b7222752B671CC392173F`
- Network: Base Sepolia
- Chain ID: `84532`
- Circle test-USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

The retained local operator configuration identifies a different LP Sender. Its value is deliberately not copied into staging. The provisioner requires the local operator to type the full LP Sender and rejects equality with the receiver.

The receiver is not yet stored in a durable staging environment. The provisioner requires an interactive local terminal and the exact confirmation `CONFIRM BASE-SEPOLIA 84532`; piped or automated confirmation is rejected.

## Durable secret set

`scripts/provision-staging-secrets.sh` creates a new, previously nonexistent directory outside the repository with mode `0700`, then creates only mode-`0600` files:

- an independent 256-bit PostgreSQL password;
- an order-data AES keyring with explicit active version 1;
- an independent relay-data AES keyring with explicit active version 1;
- an independent 256-bit operator HMAC key;
- separate Ed25519 coordinator and verifier signing identities;
- an independent encrypted-backup passphrase;
- a public/path-only `staging.env` binding the reviewed receiver, chain, token, project, volume, runtime IDs, and backup credential path.

The provisioner refuses an existing target path, an existing durable Compose project, or an existing durable database volume. It prints no credential value. `scripts/staging-durable-check.sh` validates modes, ownership, keyring versions and lengths, Ed25519 public/private pairing, wallet-key absence, destination constants, dataset isolation, and resolved Compose syntax without displaying secrets.

## Final approved activation commands

Run these commands from the repository root in a local operator terminal. They deliberately use `--no-recreate`, never use `down`, and never use a volume-removal option.

### 1. Provision and validate

```bash
./scripts/provision-staging-secrets.sh

STAGING_ENV=/home/ali/.config/zecathon-crosschain-app/staging-durable/staging.env
./scripts/staging-durable-check.sh "$STAGING_ENV"
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml config --quiet
```

Before continuing, confirm the legacy and durable identities are distinct:

```bash
docker ps -a --filter label=com.docker.compose.project=zecathon-staging --format '{{.Names}}\t{{.Status}}'
docker volume inspect zecathon_staging_postgres_data --format '{{.Name}}\t{{.CreatedAt}}'
docker ps -a --filter label=com.docker.compose.project=zecathon-staging-durable --format '{{.Names}}\t{{.Status}}'
docker volume inspect zecathon_staging_durable_postgres_data --format '{{.Name}}\t{{.CreatedAt}}'
```

The last volume inspection is expected to report “not found” before the first activation. Stop if it unexpectedly exists.

### 2. Start PostgreSQL and apply migrations 001–006

```bash
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml up -d --no-recreate --wait postgres
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml up --no-recreate migrate
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml exec -T postgres \
  psql -U zecathon_staging -d zecathon_staging_live -v ON_ERROR_STOP=1 -Atc \
  "SELECT version FROM schema_migrations ORDER BY version"
```

Require exactly:

```text
001_production_foundation
002_settlement_integration
003_private_verification_relay
004_crash_safe_address_allocation
005_passkey_identity
006_staging_keyring_canary
```

### 3. Start and verify the standalone API

```bash
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml up -d --no-recreate --wait api
curl --fail --silent --show-error http://127.0.0.1:8787/health/live
curl --fail --silent --show-error http://127.0.0.1:8787/health/ready
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml exec -T api \
  node --experimental-strip-types scripts/staging-keyring-check.ts
```

The canary command must report `STAGING_KEYRING_VERIFIED` and `activeVersion: 1`.

### 4. Inspect operator and persistent order state

These commands are read-only. Compose retains their stopped one-off containers because this milestone forbids container deletion.

```bash
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml --profile operator \
  run -T --no-deps operator status
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml --profile operator \
  run -T --no-deps operator orders
```

The new durable database must initially contain no silently imported legacy accounts, requests, orders, receipts, authorizations, replay references, or relay records.

### 5. Start the isolated verifier relay

```bash
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml --profile relay \
  up --no-recreate verifier-relay
```

With no verification job, the one-shot worker must exit with `IDLE`. This proves database access, relay key loading, and identity registration only. It does not prove access to the approved Zcash read-only evidence endpoint. The service publishes no port, and PostgreSQL also publishes no port.

### 6. Prove application restart recovery

```bash
ORDER_STATE_BEFORE=$(docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml --profile operator \
  run -T --no-deps operator orders)
docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml restart api
curl --fail --silent --show-error --retry 20 --retry-delay 1 http://127.0.0.1:8787/health/ready
ORDER_STATE_AFTER=$(docker compose --env-file "$STAGING_ENV" -f compose.staging.yaml --profile operator \
  run -T --no-deps operator orders)
test "$ORDER_STATE_BEFORE" = "$ORDER_STATE_AFTER"
unset ORDER_STATE_BEFORE ORDER_STATE_AFTER
```

Repeat this check after the first unresolved, unfunded test record exists and before any funded order is approved. That is the operational proof that an unresolved order survives an application restart.

### 7. Create an encrypted backup and run the isolated restore/restart drill

```bash
STAGING_BACKUPS=/home/ali/.local/share/zecathon-crosschain-app/staging-durable-backups
./scripts/staging-backup.sh "$STAGING_ENV" "$STAGING_BACKUPS"

BACKUP_ARCHIVE=/home/ali/.local/share/zecathon-crosschain-app/staging-durable-backups/zecathon-staging-TIMESTAMP.tar.gz.gpg
RESTORE_DRILL_ID=zecathon-staging-durable-restore-drill-01 \
  ./scripts/staging-restore-drill.sh "$BACKUP_ARCHIVE" "$STAGING_ENV"
```

The backup contains the database dump, migration inventory, matching order and relay keyrings, operator HMAC identity, relay signing identities, public/path configuration, and internal SHA-256 manifest. The encrypted archive has a separate SHA-256 sidecar. The backup passphrase is not placed inside the archive. The restore drill validates both checksum layers, decrypts every encrypted record class, inventories audit/replay/authorization/order/relay records, restarts isolated PostgreSQL, repeats the verification, and rejects any inventory change across restart. It retains its isolated container and volume for inspection.

### 8. Re-run all gates

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm privacy:scan
corepack pnpm security:gate
corepack pnpm staging:gate
corepack pnpm smoke:passkey -- http://127.0.0.1:8787
```

## Safety conclusions and remaining blockers

- The public API contains no operator settlement mutation routes. Operator mutations exist only in the local CLI and require an interactive terminal plus exact per-command confirmation.
- The server secret set contains no wallet spending key, mnemonic, seed, `keys.toml`, or UFVK.
- PostgreSQL and the verifier relay have no published host port; the API binds only to host loopback.
- Private receipt lookup is account-scoped and cross-account access returns `404`; passkey/session and ownership tests cover this behavior.
- Payout state requires a scoped, signed, one-time operator authorization. This application does not hold a Base signing key and cannot broadcast a payout.
- Durable credentials, database, canary, backup, restore, browser passkey, and restart evidence do not yet exist because the required local operator provisioning confirmation has not occurred.
- The verifier container's approved access path to the locked/watch-only Zcash evidence source remains unresolved. An idle relay is not end-to-end verifier readiness, and the current host-loopback wallet arrangement is not reachable from the isolated container without a separately reviewed credential and network design.
- Recovery of a real unresolved record across restart must be demonstrated after an unfunded record exists and before any funded order.

Therefore `DURABLE_STAGING_READY` must not be declared yet.
