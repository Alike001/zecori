# Production deployment runbook

This stack is a foundation for a hardened VPS deployment. It does not enable mainnet, wallet unlocking, address derivation, transaction signing, or payouts.

Durable passkey identity is implemented, but public launch remains blocked on final-domain HTTPS/RP-ID validation and the operational gates in [milestone 05 staging](staging-milestone-05.md).

## Architecture

- Caddy is the only internet-facing service and obtains TLS certificates for `DOMAIN`.
- The Node API serves the built React application and `/api/v1` on an internal network.
- PostgreSQL is reachable only on the internal data network and uses a named durable volume.
- The verifier has no published port. Its Base verification endpoint requires a separate service token. Zcash verification is deliberately not containerized until a dedicated testnet verification node can be provisioned without copying an operator wallet.
- Operator mutation commands remain outside the public HTTP surface.

## First start

Install Docker Engine with the Compose plugin on a patched VPS. Point the domain's A/AAAA record to the VPS and allow inbound TCP 80/443 only.

```bash
cp .env.example .env
mkdir -p deploy/secrets
openssl rand -hex 32 > deploy/secrets/db_password
openssl rand -hex 32 > deploy/secrets/verifier_token
node -e "const {randomBytes}=require('node:crypto'); process.stdout.write(JSON.stringify({activeVersion:1,keys:{1:randomBytes(32).toString('base64')}})+'\\n')" > deploy/secrets/encryption-keyring.json
chmod 700 deploy/secrets
sudo chown 10001:10001 deploy/secrets/db_password deploy/secrets/verifier_token deploy/secrets/encryption-keyring.json
chmod 400 deploy/secrets/db_password deploy/secrets/verifier_token deploy/secrets/encryption-keyring.json
chmod 600 .env
```

Set `DOMAIN` and an operator-approved HTTPS `BASE_SEPOLIA_RPC_URL` in `.env`. There is no fixed or fallback payout recipient: every destination must come from the authenticated owner's immutable intent and satisfy the required wallet-control proof. Never place wallet cookies, wallet keys, seed material, operator HMAC keys, database passwords, or user recipient records in `.env` or Git.

UID/GID `10001` is the pinned unprivileged `zecathon` user inside the image. Local Docker Compose secrets are bind mounts, so the host files must be readable by that numeric owner while remaining unreadable to other host users.

```bash
docker compose config --quiet
VCS_REF="$(git rev-parse HEAD)" docker compose build
docker compose up -d postgres
docker compose run --rm api node --experimental-strip-types scripts/migrate.ts
docker compose up -d
curl --fail https://$DOMAIN/health/ready
node scripts/smoke-production.mjs https://$DOMAIN
```

Before building, verify `git rev-parse HEAD` is the reviewed commit and returns exactly 40 lowercase hexadecimal characters. Compose also binds `WEBAUTHN_RP_ID` to `DOMAIN`; changing either value requires registering passkeys again on the final HTTPS origin.

Do not mount the existing Wallet A or Wallet B data directories into these containers. The source verifier remains outside this public stack pending the watch-only compatibility gate in [production verifier architecture](production-verifier.md).

## Production secrets checklist

Provision each value independently; never reuse a key across roles.

- PostgreSQL password: random, at least 32 bytes, Compose secret, recoverable from the encrypted infrastructure vault.
- Database encryption keyring: versioned 32-byte AES keys, mode `0600`, directory mode `0700`, backed up separately from database dumps. Retain every version referenced by a row; rotate by adding a version and changing `activeVersion`, then re-encrypt in a reviewed maintenance operation before retiring an old key.
- Relay message encryption keyring: a different versioned AES-256-GCM keyring shared only by the coordinator and operator verifier. It encrypts queued challenges/responses but cannot decrypt orders, receipts or allocations.
- Receipt/operator HMAC key: operator host only; never in the web image, database keyring or verifier.
- Base verifier token: isolated verifier secret only. Rotate after any suspected disclosure.
- Relay coordinator Ed25519 private key: coordinator only. Store its public key on the operator host.
- Relay verifier Ed25519 private key: operator verifier host only. Store its public key on the coordinator. The two private keys must never share a host or backup.
- Caddy state: preserve `/data` for certificate continuity; no wallet material belongs in it.
- No seed, mnemonic, UFVK, zecd `keys.toml`, wallet DB, wallet RPC cookie, Wallet A/B data directory or payout signer may be copied to the VPS, image, Compose secret or Git.

Run the read-only static gate from a clean `main` checkout:

```bash
corepack pnpm preflight -- --static
```

Run the full gate only after secrets and backup paths are staged locally. It validates existence, modes and schemas without printing values:

```bash
DOMAIN=swap.example.org \
DB_PASSWORD_FILE=/secure/db_password \
VERIFIER_TOKEN_FILE=/secure/verifier_token \
ZECATHON_ENCRYPTION_KEY_FILE=/secure/encryption-keyring.json \
ZECATHON_RELAY_ENCRYPTION_KEY_FILE=/secure/relay-encryption-keyring.json \
ZECATHON_RELAY_COORDINATOR_PRIVATE_KEY_FILE=/secure/relay-coordinator.pk8.pem \
ZECATHON_RELAY_VERIFIER_PUBLIC_KEY_FILE=/secure/relay-verifier.spki.pem \
BACKUP_DIRECTORY=/secure/backups \
corepack pnpm preflight
```

## Backup

Create backups outside the repository and encrypt them before off-host storage:

```bash
mkdir -p backups
chmod 700 backups
docker compose exec -T postgres pg_dump -U zecathon -d zecathon --format=custom > backups/zecathon-$(date -u +%Y%m%dT%H%M%SZ).dump
chmod 600 backups/*.dump
```

Test restores regularly against an isolated empty database. A backup is not verified until the restore and integrity checks succeed.

## Restore drill

Stop API traffic, retain the original volume, and restore into a new database first:

```bash
docker compose exec -T postgres createdb -U zecathon zecathon_restore
docker compose exec -T postgres pg_restore -U zecathon -d zecathon_restore --clean --if-exists < backups/FILE.dump
docker compose exec -T postgres psql -U zecathon -d zecathon_restore -c 'SELECT version, applied_at FROM schema_migrations ORDER BY version;'
```

Do not replace the live database until request counts, order counts, allocation uniqueness, receipts, authorization records, and audit history have been reconciled.

The restore environment must receive a copy of every referenced encryption-key version. Test both successful decryption and failure with an intentionally absent old version. Restore drills must also confirm pending relay jobs, leases, replay fingerprints, authorization state and `UNRESOLVED` orders. Never test a restore by replacing the only live volume.

## Health and monitoring

- Alert on public `/health/ready` failure, PostgreSQL readiness, restart loops, disk/volume pressure, TLS renewal, backup age and restore-drill age.
- Alert on relay jobs that are `PENDING`/`DISPATCHED` past expiry, repeated lease attempts, `UNRESOLVED` outcomes, evidence replay rejection and source reorg reconciliation.
- Logs may contain request IDs, order-state names and reason codes. They must not contain receivers, transaction correlations, UFVKs, RPC cookies, private receipts, raw relay payloads or decrypted database records.
- Caddy is the only service with host ports. PostgreSQL, API upstream and verifier networks stay private. The verifier exposes no wallet-RPC pass-through route.

## Staged public-launch runbook

1. **Build candidate:** clean `main`, pinned toolchain, full tests/typecheck/build/privacy/security gates, SBOM/image inspection, and static preflight.
2. **Restore rehearsal:** encrypted backup plus isolated restore; reconcile schema versions, counts, unique allocations/replays, receipts, audit history and relay queue.
3. **Private staging:** start PostgreSQL/API/Caddy with a non-public hostname or access control. Run migration, health checks, Docker smoke and restart/recovery. No wallet material is present.
4. **Verifier staging:** provision separate Ed25519 identities and mutually authenticated tunnel. Use TEST-ONLY deterministic evidence first. Do not import a UFVK until a separate ceremony is approved.
5. **Authentication gate:** configure the final HTTPS origin and explicit RP ID, register two real passkeys, and repeat session rotation/revocation, ownership, challenge replay, and CSRF tests on that exact domain. Localhost credentials are not portable.
6. **Read-only canary:** expose informational pages and request creation only after monitoring/backup alerts are green. Operator mutation remains CLI-only.
7. **First linked testnet order:** follow [the separate approval runbook](first-linked-test-readiness.md). Each wallet start, address allocation, source transfer and Base payout is a separate approval. Stop on uncertainty.
8. **Promotion decision:** review receipts, logs, privacy scan, reorg behavior, backup evidence and unresolved queue. Mainnet remains out of scope.

## Updates and rollback

Build and run all validation before replacing the API image. Database migrations are forward-only and must be backed up first. Never run `docker compose down -v`; it deletes the PostgreSQL volume.
