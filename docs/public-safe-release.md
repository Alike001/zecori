# Public judge release

The public Render service is separate from any local financial coordinator. This
release includes destination-wallet provider selection and verification retries,
separate payment deadlines, responsive status/receipt presentation, and guarded
operator tooling. The landing page and public documentation remain available.
No completed real cross-chain settlement is claimed by this release.

## Database and passkeys

Public startup runs `scripts/verify-public-schema.ts` in a PostgreSQL read-only
transaction. It requires migrations 001–017 already recorded; it never runs DDL
or migration scripts. A missing version blocks startup. Do not enable automatic
migration or apply pending migrations to make a deployment pass without a
separately reviewed backup, restore proof and migration approval.

Keep the existing Neon database, encryption secret, HTTPS origin
`https://zecori.iamalikex.tech`, RP ID `zecori.iamalikex.tech`, and passkey records.
This release does not change authentication schema or credential encoding.
Verify an existing passkey after deployment; do not replace keys or credentials.

## Deployment gate

1. Review the PR and require green CI on its exact head.
2. Read the existing Neon migration inventory without mutation. All 001–017 must
   already exist. Preserve a current backup and existing secret configuration.
3. Keep route requests, liquidity readiness, variable financial quotes, Privy and
   contract-wallet verification disabled. Never configure private request-window,
   operator login, operator database or payout-approval settings on Render.
4. Obtain explicit release approval, then merge the reviewed PR into `main`.
5. Automatic deployment stays off. In the existing `zecori-judge` Render service,
   manually deploy the approved merged commit; record its full SHA and verify
   `/health/live`, `/health/ready`, `/api/v1/capabilities`, landing, `/app`, `/docs`,
   authenticated Activity and an existing passkey. Do not create a payment order.
6. Verify public URLs cannot serve the private operator UI, login API, journal
   actions, source signing or payout controls. A generic SPA fallback is not a
   private endpoint; check response contents as well as status codes.

The private MetaMask service is a separate executable binding only 127.0.0.1.
It refuses Render startup and is never imported or mounted by the public app.
Its assets are outside the Vite public build. No private operator credentials,
wallet data, local inventory or operational transcripts belong in this release.

If compatibility verification fails, keep the existing deployment and review the
missing schema separately. No production migration is authorized by this guide.
