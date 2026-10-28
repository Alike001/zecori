# Free Render + Neon judge deployment

Status: deployed and web-health reverified at [https://zecori.iamalikex.tech](https://zecori.iamalikex.tech) on 2026-10-28. Ten Neon migrations, HTTPS, liveness, readiness, guarded judge smoke, one real passkey sign-in, and one handle claim are recorded as verified. No Render credential was available during the final audit, so the exact deployed SHA and dashboard-only values remain unverified. This runbook does not authorize another repository push, DNS change, database migration, provider activation, wallet access, signing, broadcasting, or settlement.

## Compatibility decision

The existing Node process already serves both `dist/` and `/api/v1`, so Zecori fits one Render Node web service without a frontend/backend split. `render.yaml` selects the free Node runtime, pins Node 24.14.1, binds the process to Render's `PORT` on `0.0.0.0`, checks `/health/ready`, and fixes the WebAuthn origin and RP ID to `https://zecori.iamalikex.tech`.

The final DNS audit resolved `zecori.iamalikex.tech` as a CNAME to `zecori-judge.onrender.com`. The `iamalikex.tech` DNS service supplies records only; it does not run Zecori's Node backend. The apex itself had no A record during the check. Do not treat a free registration or DNS control panel as compute hosting.

The service stores all durable application state in an external Neon PostgreSQL database. Render's filesystem is disposable and must contain no database, wallet, key, receipt-evidence, upload, or operator file. The only runtime file is a Render-managed secret file containing the database encryption keyring. Its durable source of truth is the operator's password manager or encrypted vault, not the service filesystem.

The free service is suitable for a judge demo, not an always-on production financial service:

- Render free web compute is 0.1 CPU and 512 MB RAM, supplies 750 running hours per workspace each month, and sleeps after 15 minutes without inbound traffic. A cold request can take about one minute.
- Render free web files disappear on restart, redeploy, or sleep. There is no free persistent disk, shell, one-off job, or paid pre-deploy hook.
- Neon free PostgreSQL is external, TLS-only, persistent across Render restarts, and scales to zero. As of 2026-10-27 its free plan advertises 1 GB per project and 100 CU-hours per project per month.
- `scripts/render-start.sh` therefore runs the repository's idempotent migrations before starting HTTP. `migrateDatabase` serializes concurrent starts with a PostgreSQL advisory lock and records every applied migration. A failed migration prevents the service from becoming ready.
- The in-process inbox outbox dispatcher runs every five seconds while Render is awake. It is restart-safe and PostgreSQL-backed; it is not a separate cron service. Render sleep pauses dispatch, and the next inbox read also drains pending items.

Official references: [Render free limits](https://render.com/docs/free), [Render port binding](https://render.com/docs/web-services#port-binding), [Render Blueprints](https://render.com/docs/blueprint-spec), [Render secret files](https://render.com/docs/configure-environment-variables#secret-files), [Neon TLS connection format](https://neon.com/docs/connect/connect-from-any-app), and [Neon free-plan announcement](https://neon.com/blog/neon-free-plan-1-gb-per-project).

## One-time secret preparation

Create a new encryption keyring for this judge database. Never reuse staging or local keys. Run this outside the repository in a private shell and save the value directly in an encrypted password manager:

```bash
umask 077
node -e "const {randomBytes}=require('node:crypto');process.stdout.write(JSON.stringify({activeVersion:1,keys:{1:randomBytes(32).toString('base64')}})+'\n')"
```

The saved JSON and the Neon database must be backed up together. Losing the keyring makes encrypted destinations, contacts, instructions, evidence, and private receipts unrecoverable. Do not paste it into an environment variable, build log, source file, issue, or chat.

## Neon console setup

1. Create a free Neon account. Create a **new project**, named `zecori-judge`; do not select, branch, import, or rename any staging project.
2. Choose the AWS Frankfurt region when available so it is geographically aligned with the Render service. Keep the default PostgreSQL database dedicated to this demo.
3. On **Dashboard > Connection Details**, select the primary branch, select **Pooled connection**, and copy the connection string. Confirm its hostname contains `-pooler` and its query contains `sslmode=require` (or stricter `sslmode=verify-full`).
4. Store that exact value as `DATABASE_URL` only in Render. Do not run `pnpm db:migrate` against it from the developer laptop. The guarded Render startup performs migrations 001–010.
5. In Neon, verify the project is empty before first deployment. After deployment, use the SQL editor only for read-only confirmation:

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version;
```

Expected result: exactly migrations `001_production_foundation` through `010_handles_contacts_inbox`. Do not point these instructions at staging, and do not copy staging rows into the judge project.

## Render dashboard setup

These steps document the deployed configuration and remain the recovery/recreation procedure. Publishing or pushing a new revision remains a separate operator action.

1. Create a free Render account/workspace without adding a payment method. Connect only the repository containing the reviewed Zecori commit.
2. Select **New > Blueprint**, choose the repository and `feat/milestone-08a-consumer-privy`, and let Render read the root `render.yaml`.
3. Confirm the proposed resource is exactly one `zecori-judge` **Web Service**, runtime **Node**, region **Frankfurt**, plan **Free**, with no database, disk, worker, cron job, or second service. Automatic deploys must remain off.
4. When prompted, enter:
   - `DATABASE_URL`: the new Neon pooled TLS URL.
   - `BASE_SEPOLIA_RPC_URL`: a trusted read-only HTTPS Base Sepolia endpoint. This grants no signing authority.
5. The first start is expected to fail closed until the key file exists. Open **zecori-judge > Environment > Secret Files > Add Secret File**. Set filename to `zecori-encryption-keyring.json`, paste the new judge-only JSON, save, and redeploy. Render mounts it at `/etc/secrets/zecori-encryption-keyring.json`.
6. Recheck the fixed environment values from `render.yaml`: `NODE_ENV=production`, `HOST=0.0.0.0`, `TRUST_PROXY=1`, exact public origin/RP ID, and all route, liquidity, ERC-1271, Privy, and voice flags set to `0`. Do not add AI keys, verifier keys, wallet material, payout keys, UFVKs, RPC cookies, or settlement evidence.
7. Watch the deploy log. It may show migration names and the listening host/port; it must not print connection strings or key material. Wait for `/health/ready` to pass.

Render's paid-only pre-deploy command is deliberately not used. The guarded startup refuses to migrate unless its judge-deployment marker is exact, the connection URL requires TLS, the origin/RP ID are the final hostname, and all financial readiness switches remain off.

## DNS and TLS

1. In **Render > zecori-judge > Settings > Custom Domains**, confirm `zecori.iamalikex.tech` is present.
2. At the DNS provider for `iamalikex.tech`, remove any `AAAA` record specifically for `zecori`. Add a DNS-only CNAME named `zecori` pointing to the service's assigned `<name>.onrender.com` hostname. If Cloudflare manages DNS, start with proxying disabled and SSL mode Full.
3. Return to Render and click **Verify**. Wait for its managed certificate to be issued.
4. Do not change `PUBLIC_ORIGIN` or `WEBAUTHN_RP_ID` to the temporary Render hostname. The Blueprint disables that hostname so passkeys have one stable RP boundary.

## Hosted acceptance

After TLS is valid, run only read-only/public checks from any computer:

```bash
curl --fail https://zecori.iamalikex.tech/health/live
curl --fail https://zecori.iamalikex.tech/health/ready
EXPECT_ROUTE_REQUESTS=0 node scripts/smoke-judge.mjs https://zecori.iamalikex.tech
```

Then use two fresh browser profiles on the final hostname to register synthetic passkey accounts and check account isolation, logout/login recovery, handles, private contacts, non-paying handle requests, inbox, activity/history, receipts, French, Arabic RTL, reduced motion, and mobile layouts. Confirm `/api/v1/capabilities` reports the route as `operator-review-required` with execution disabled. A free-service cold start is expected behavior, not settlement evidence.

Once deployed, no developer laptop process is required for the public application. Live settlement would still require a separately hosted verifier/operator system described in `docs/private-verifier-hosting.md`; while that system is absent, the judge application remains an honest non-executing product demo.

## Recovery and limits

- Keep the Neon project and encryption keyring unique to the judge environment. A Neon branch is useful for a restore rehearsal but is not a substitute for an independently recoverable encrypted backup.
- Render free usage overages suspend service/builds when no payment method exists instead of charging. Monitor the free quotas; do not add a card merely to keep the demo online.
- If the single Node service exceeds 512 MB in observed use, the fallback is a free Render static site plus this same free API. That split is not presently justified and would require explicit CORS and cookie-domain work; do not introduce it preemptively.
- A static-edge split would also change WebAuthn origin/RP acceptance, host-only cookie behavior, CSRF/origin checks, CSP `connect-src`, API preflights, cache rules, cold-start visibility, and the security review boundary. It may reduce static asset latency but cannot remove Render/Neon latency from authenticated actions. Keep the same origin through submission.
- Never enable route requests or liquidity in this Blueprint. Executable settlement needs a separate reviewed release and explicit financial authorization.
