# Milestone 05 — durable staging and secure identity

Status: **implementation and TEST-ONLY validation complete; funded linked swap blocked on operational approvals**.

No wallet was started or unlocked. No address was derived, no transaction was signed or broadcast, no payout was authorized, and no testnet/mainnet funds moved.

## Durable staging

`compose.staging.yaml` is an isolated `zecathon-staging` project. It uses PostgreSQL `17.7`, the explicitly named `zecathon_staging_postgres_data` volume, the dedicated `zecathon_staging_live` database/user, an internal data network, and no host database port. The API is published only at `127.0.0.1:8787`. Operator and private verifier-relay profiles inherit the same database configuration; neither profile starts by default.

The interactive provisioner creates independent database, order AES-256-GCM, relay AES-256-GCM, operator HMAC, and coordinator/verifier Ed25519 keys outside the repository. It refuses a non-empty target, uses mode `0700`/`0600`, and never displays key values. Local Compose services run as the provisioning user's numeric UID/GID so mode-0600 bind-mounted secrets remain readable without making them world-readable.

## Passkey identity

Migration `005_passkey_identity` adds stable users, multiple passkey credentials, one-time five-minute ceremonies, hashed database sessions, revocation, credential counters, and append-only identity audit events. Registration and authentication require user verification and validate both the exact configured origin and RP ID through the security-patched SimpleWebAuthn server `13.3.2`.

Orders remain scoped through the existing hashed owner column, but its input is now the stable account UUID rather than a browser capability. A new authenticated session therefore sees the same order history and private receipts. Anonymous order creation and private receipt access return `401`; cross-account lookup returns `404`. Adding a passkey rotates the current session. Logout revokes the server-side session and clears both cookies.

Local staging deliberately uses `http://localhost:8787` with RP ID `localhost`, which browsers treat as a trustworthy loopback context. This credential scope does not migrate to another hostname. Production startup requires HTTPS, `TRUST_PROXY=1`, and an explicit `WEBAUTHN_RP_ID` matching the public hostname or its parent domain.

## Backup and recovery evidence

Migration `006_staging_keyring_canary` provides a non-sensitive encrypted continuity marker. `staging-keyring-check.ts` proved that the same canary decrypted after PostgreSQL restart.

The backup command creates a GnuPG AES-256 encrypted archive containing a custom PostgreSQL dump, migration inventory, matching order/relay keyrings, HMAC and relay identities, plus SHA-256 checksums. The restore command refuses an existing target unless resuming an inspected empty failed drill, restores to a separate container/volume, and verifies every encrypted envelope against its context and matching keyring. It never replaces the live volume.

The TEST-ONLY drill restored migrations `001`–`006`, verified all archive hashes, and decrypted the keyring canary. The isolated restore container and volume were retained for inspection as required.

## Exact local staging commands

Inspect before creating anything:

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker volume ls --format '{{.Name}}'
```

Provision into a durable, backed-up path outside the repository (do not use `/tmp` for a real testnet settlement):

```bash
scripts/provision-staging-secrets.sh
```

The provisioner prints only the path to `staging.env`. Start the non-wallet staging services with that absolute path:

```bash
docker compose --env-file /ABSOLUTE/PRIVATE/PATH/staging.env -f compose.staging.yaml config --quiet
docker compose --env-file /ABSOLUTE/PRIVATE/PATH/staging.env -f compose.staging.yaml build api migrate
docker compose --env-file /ABSOLUTE/PRIVATE/PATH/staging.env -f compose.staging.yaml up -d postgres migrate api
curl --fail http://localhost:8787/health/ready
corepack pnpm smoke:passkey -- http://localhost:8787
```

Read-only operator connectivity check:

```bash
docker compose --env-file /ABSOLUTE/PRIVATE/PATH/staging.env -f compose.staging.yaml --profile operator run --rm operator
```

Create and verify an encrypted backup before any funded order:

```bash
scripts/staging-backup.sh /ABSOLUTE/PRIVATE/PATH/staging.env /ABSOLUTE/PRIVATE/BACKUP/DIRECTORY
scripts/staging-restore-drill.sh /ABSOLUTE/PRIVATE/BACKUP/DIRECTORY/zecathon-staging-TIMESTAMP.tar.gz.gpg
```

Never run `docker compose down -v`. Inspect the exact staging container and volume before any cleanup; the restore drill intentionally retains its isolated artifacts.

## Remaining first-linked-swap blockers

- Re-provision outside `/tmp` with a human-confirmed Base Sepolia receiver and a separately retained backup passphrase. The TEST-ONLY receiver used for automated validation must never receive funds.
- Register two real passkeys for the intended staging account and complete a human browser login/logout/recovery check on the final host.
- Re-run the read-only Wallet A funding proof while the existing wallet is separately approved, running, locked, synchronized, and demonstrably holds at least `1,010,000` spendable Ironwood zatoshis.
- Separately approve and validate the existing Wallet B process before the one allowed guarded receiver allocation. No address was derived in this milestone.
- Approve the private relay transport/host topology for the live evidence path. Local staging proved shared-database identity and an idle signed-relay worker, not production mTLS.
- Keep source payment signing and Base payout signing as separate external approvals. Neither signer exists in this application.

Only after those blockers and a fresh backup/restore drill are satisfied may a fresh `0.01 TAZ → 1 test USDC` order be considered. This milestone did not create or fund that order.
