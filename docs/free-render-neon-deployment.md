# Existing Render + Neon judge deployment

Public URL: [zecori.iamalikex.tech](https://zecori.iamalikex.tech).
Service: `zecori-judge`; repository: `Alike001/zecori`; branch: `main`.
Automatic deployment remains disabled. Use the existing service and Neon database.
This guide does not authorize a deployment, migration or financial operation.

See [the current public release gate](public-safe-release.md) before any update.
Older first-install instructions that ran migrations during Render startup are
superseded. Do not recreate the database, regenerate its encryption keyring, or
replace passkey data when updating the existing site.

## Read-only compatibility review

In the existing Neon project's SQL editor, inspect only:

```sql
BEGIN READ ONLY;
SELECT version, applied_at FROM schema_migrations ORDER BY version;
COMMIT;
```

The current implementation requires all migrations 001–017. If Neon has only
001–010, migrations 011–017 require a separate backup/restore and migration review;
if it has 001–015, the pending versions are 016–017. A historical audit is not a
fresh schema check. Do not run `pnpm db:migrate` against production.

`scripts/render-start.sh` runs only read-only schema verification before HTTP
startup. It fails closed on a missing version and never applies migrations.
Normal authenticated application writes and the existing inbox dispatcher remain
part of the product; this change removes deployment-time schema mutation.

## Reviewed release procedure

1. Require green CI on the reviewed PR, current database compatibility evidence,
   and explicit approval before merging and manually deploying the approved SHA.
2. Preserve the existing `DATABASE_URL` and Render-managed encryption secret file
   `/etc/secrets/zecori-encryption-keyring.json`. Never copy local coordinator keys.
3. Retain `PUBLIC_ORIGIN=https://zecori.iamalikex.tech`,
   `WEBAUTHN_RP_ID=zecori.iamalikex.tech`, `NODE_ENV=production`, `HOST=0.0.0.0`,
   and `TRUST_PROXY=1`. Keep all financial flags disabled as in `render.yaml`.
4. Verify the existing service tracks `main` and auto-deploy is off. After approval
   and merge, manually deploy the exact approved main commit in Render. Record
   the full deployed SHA; a green public health response alone does not prove it.
5. Check startup logs for `public_schema_compatible` with 17 required migrations,
   and confirm there was no migration invocation. Never publish connection URLs,
   secrets or private operator logs.
6. Run the following public non-spending check, then sign in with an existing
   passkey and inspect the landing page, app, docs, Activity and receipts. Do not
   create orders or allocate receivers as a release smoke test.

```bash
EXPECT_ROUTE_REQUESTS=0 node scripts/smoke-judge.mjs https://zecori.iamalikex.tech
```

Confirm `/api/v1/capabilities` keeps order creation disabled. Verify operator
login, journal mutation and signing routes are absent from the public service.
The private MetaMask operator is a separate localhost-only executable.

Keep the stable domain and RP ID to preserve passkey compatibility. Keep the
existing Render/Neon resources, TLS connection requirements, DNS and secrets.
Neon restore or schema repair requires a separately approved procedure. If the
new release cannot start, preserve the existing deployment while investigating.
