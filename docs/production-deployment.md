# Production deployment runbook

This stack is a foundation for a hardened VPS deployment. It does not enable mainnet, wallet unlocking, address derivation, transaction signing, or payouts.

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

Set `DOMAIN` and the public Base Sepolia receiver in `.env`. Never place wallet cookies, wallet keys, seed material, operator HMAC keys, or database passwords in `.env` or Git.

UID/GID `10001` is the pinned unprivileged `zecathon` user inside the image. Local Docker Compose secrets are bind mounts, so the host files must be readable by that numeric owner while remaining unreadable to other host users.

```bash
docker compose config --quiet
docker compose build
docker compose up -d postgres
docker compose run --rm api node --experimental-strip-types scripts/migrate.ts
docker compose up -d
curl --fail https://$DOMAIN/health/ready
node scripts/smoke-production.mjs https://$DOMAIN
```

Do not mount the existing Wallet A or Wallet B data directories into these containers. The source verifier remains outside this public stack pending the watch-only compatibility gate in [production verifier architecture](production-verifier.md).

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

## Updates and rollback

Build and run all validation before replacing the API image. Database migrations are forward-only and must be backed up first. Never run `docker compose down -v`; it deletes the PostgreSQL volume.
