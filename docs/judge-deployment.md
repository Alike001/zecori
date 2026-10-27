# Isolated judge deployment

For the zero-budget public judge path, use [Free Render + Neon judge deployment](free-render-neon-deployment.md). The Compose instructions below remain the dedicated-host alternative and must not be used on Render.

Status: prepared, not deployed. This runbook does not authorize DNS changes, host access, secret creation, migrations, provider activation, or wallet activity.

The standalone `compose.judge.yaml` assigns a distinct Compose project, database name, PostgreSQL/Caddy volumes, and secret directory. Do not combine it with staging or production Compose files. It must never reuse a staging hostname, project name, volume, database, backup, password, encryption key, WebAuthn RP ID, or account data.

## Required operator inputs

- A dedicated patched host and public judge hostname with DNS under operator control.
- Explicit deployment and migration authorization.
- A new database password, verifier token, and encryption keyring stored under `deploy/judge/secrets/` on that host with the ownership/modes from `docs/production-deployment.md`.
- A trusted Base Sepolia HTTPS RPC URL. No payout signer, Zcash wallet, wallet data, relay private key, or staging backup belongs on this host.
- The exact reviewed 40-character `VCS_REF`.

## Immediate deployment checklist

1. Authorize one dedicated host and final HTTPS hostname; set DNS before passkey acceptance.
2. Create fresh judge-only database, encryption, verifier and TLS secrets. Verify file ownership/mode without printing values.
3. Set `PUBLIC_ORIGIN=https://<judge-host>` and `WEBAUTHN_RP_ID=<judge-host>` to the exact final hostname; do not use an IP address, staging hostname or temporary preview origin.
4. Keep request and liquidity flags at `0`, render `compose.judge.yaml`, and confirm every project, network, volume and database name is judge-only.
5. Build, migrate only the new judge database, start TLS, and run `smoke-judge.mjs` against the public HTTPS origin.
6. Complete the two-fresh-profile acceptance and isolated backup/restore check below before considering any route flag change.

Keep `ZECATHON_ROUTE_REQUESTS_ENABLED=0` and `ZECATHON_ROUTE_LIQUIDITY_READY=0` for the first deployment. Public exploration, authentication, handles, contacts, inbox, history, and recovery can be accepted in this mode. Opening requests requires all three independent gates: operator readiness set to `1`, liquidity readiness set to `1`, and a reviewed future UTC `ZECATHON_ROUTE_TERMS_VALID_UNTIL`. Expired terms close the route automatically. These gates open request creation only; they do not allocate an address, sign, broadcast, pay out, or prove settlement.

## Preflight and first start

Run from a clean checkout of the reviewed commit. Replace the hostname and RPC URL; do not use shell history for secrets.

```bash
export JUDGE_COMPOSE_PROJECT_NAME=zecori-judge
export DOMAIN=judge.example.org
export VCS_REF=<REVIEWED_40_HEX_SHA>
export BASE_SEPOLIA_RPC_URL=https://operator-approved.example
export ZECATHON_ROUTE_REQUESTS_ENABLED=0
export ZECATHON_ROUTE_LIQUIDITY_READY=0

docker compose -f compose.judge.yaml config --quiet
docker compose -f compose.judge.yaml build
docker compose -f compose.judge.yaml up -d postgres
docker compose -f compose.judge.yaml run --rm api node --experimental-strip-types scripts/migrate.ts
docker compose -f compose.judge.yaml up -d
node scripts/smoke-judge.mjs https://judge.example.org
```

Before migration, inspect `docker compose ... config` and `docker volume ls` and confirm every resolved project/volume contains the dedicated judge name. Stop if any staging identifier or mount appears. Never run `docker compose down -v`.

## Acceptance without funds

Use two new browser profiles on the final HTTPS origin. Register two synthetic passkey accounts; verify restart persistence, additional-passkey recovery, session rotation, owner-isolated history, exact-match handles, private contacts, genuine inbox/outbox events, RTL Arabic, French, reduced motion, wallet rejection/network-change paths, and generic cross-account not-found responses. Confirm the capabilities endpoint reports `operator-review-required` and that the request button is disabled while the readiness flag is `0`.

Back up the judge database to a new encrypted path, restore it into a separate empty judge-restore database, and verify migrations 001–010 plus decryptability before calling the deployment persistent. Record only redacted evidence.

## Stop boundaries

Stop and obtain separate explicit authorization before changing the readiness flag to `1`, accessing or starting either Zcash wallet, deriving an address, unlocking, signing, broadcasting, recording a real transaction hash, submitting a Base payout, activating a provider, or spending funds. A completed receipt is valid only after independently verified source and destination evidence link to the same order.
