# Milestone 06D integrated release review

Review date: 2026-10-25

Verdict: **CONDITIONAL PASS for source integration and disposable rehearsal; NO-GO for a first linked staging test or production claim.**

The local Milestones 05, 06A, 06B, and 06C work is coherent, passes the automated gates listed below, and has been rehearsed without changing durable staging. The remaining no-go items require human-controlled external wallets, reviewed immutable image provenance, a fresh authenticated staging backup, and explicit operator approval. Passing these tests does not establish production readiness.

## Scope and preservation

- Reviewed `git status`, the complete tracked and untracked diff, commits through `ef8ae7d`, migrations 001-008, runtime configuration, and the deployed-versus-local image contents.
- Preserved all legitimate pre-existing work. No reset, force operation, blanket `git add`, push, deployment, secret rotation, wallet unlock, address derivation, order creation, signing, broadcast, allocation, funding, or payout was performed.
- Durable staging database containers, volumes, application containers, credentials, and the reviewed canary-repair overlay were not modified or queried for business records.
- All PostgreSQL mutations used disposable containers/volumes and synthetic `TEST-ONLY` records. All Milestone 06D disposable containers, volumes, backup archives, and credentials were removed after verification.

## Change classification

| Area | Representative files | Class | Sensitivity |
| --- | --- | --- | --- |
| Durable staging and recovery | `Dockerfile`, `compose.staging.yaml`, `docker/*`, staging/production documentation, backup/restore/keyring/preflight scripts, `server/keyring-canary*`, `server/postgres.ts` | Feature, operations, documentation | High |
| Owner-specific destination intent | migration 007, `server/destination-intent.ts`, `server/wallet-intent*`, public request store/API, order API/types, UI | Feature, migration | High |
| Cryptographic destination control | migration 008, `server/wallet-control*`, `server/destination-wallet-control-store.ts`, settlement/operator integration, UI | Feature, migration, security | Critical |
| Authentication and isolation | passkey browser script, app server/auth/PostgreSQL tests | Feature, test | Critical |
| Settlement and recovery | settlement store/operator script, PostgreSQL integration tests, inventory comparison | Feature, test, operations | Critical |
| Bounded route assistant | `server/agent-*`, provider/response validation, route registry, live validation scripts, AI operations documentation | Feature, documentation | High |
| User disclosures and wallet readiness | `src/App.tsx`, styles, i18n/voice/wallet-readiness/address tests, browser smoke | Feature, test, documentation | Medium/High |
| Dependency/configuration metadata | `.env.example`, `package.json`, `pnpm-lock.yaml`, compose files | Configuration | High |

Tests and documentation contain only conspicuously labelled synthetic account IDs, addresses, keys, and transaction-like fixture hashes. They are not wallet credentials or usable private material.

## Integration traceability

| Requirement | Evidence | Result |
| --- | --- | --- |
| User authentication and owner isolation | PostgreSQL passkey lifecycle/replay/logout test; two-owner request tests; browser cross-account 404 | Pass |
| Wallet ownership proof | Real EIP-712 signing/recovery in Node tests; ERC-1271 magic-value fixture; encrypted proof persistence | Pass for cryptographic fixtures; external wallets pending |
| Exact destination binding | Intent encryption plus recipient fingerprint; owner/request/intent foreign keys; exact chain/token/amount/consent checks | Pass |
| Order manifest and acceptance | Manifest fingerprint binds destination; operator acceptance rejects absent/failed proofs | Pass |
| Shielded allocation and private evidence | Existing exact-index, Ironwood, relay-signature, replay, and recovery tests remained green | Pass |
| Base payout authorization and receipts | Existing manual authorization, replay rejection, uncertain broadcast, linked receipt, and recipient-evidence tests remained green | Pass |
| Recovery | Disposable migration, restart, encrypted inventory, backup/restore, and legacy-row rehearsals | Pass with noted empty 007/008 backup tables |
| Destination confidentiality | Recipient stored in authenticated encryption; audit rows prohibit recipient/address/signature/nonce/typed-data fields | Pass |
| No operator receiver as user destination | Exact owner-supplied recipient is bound; browser sentinel test confirms no fixed receiver exposure | Pass |
| Destination proof is not payment authority | Purpose-specific EIP-712 domain/message and UI/API disclosures; no transaction-signing route | Pass |

## Security behavior exercised

- Single-use, expiry, concurrent consumption, duplicate creation, owner/session binding, cross-owner proof reuse, recipient substitution, and immutable proof/audit constraints.
- Base chain mismatch, account switching, wallet rejection/disconnection/network-change state clearing, missing proof, invalid proof, and unavailable RPC fail-closed behavior.
- ERC-1271 validity changing from valid to invalid at operator acceptance. The proof transitions durably to `RECHECK_FAILED` and cannot be restored.
- ERC-1271 code/signature calls pin the verification block by hash with EIP-1898 `requireCanonical`; non-canonical/reorg and RPC-unavailable fixtures fail closed.
- Existing Zcash owner isolation, locked/watch-only custody, Ironwood-only funding/evidence, independent settlement checks, authorization expiry, replay protection, and receipt redaction.

## Migration review

Required sequence and SHA-256:

1. `001_production_foundation` — `bfef4229f8d9005d5195a363cde618fcb6bc8dd6cdd0602a3a988374d8eb32a7`
2. `002_settlement_integration` — `6c09ef05ea30619fae553d445c7a3811272653d91d8c9f00bf78047d588325a2`
3. `003_private_verification_relay` — `1048cc1a934124c13f6849f93a6a0456c2de7c13d04dfb9c6e78a440b45af8c9`
4. `004_crash_safe_address_allocation` — `7c2390f9c78016effb55badd21476444ed70c9d0af63c1646757a974b0ad7a21`
5. `005_passkey_identity` — `bb08d993d7329662e1b3ad48fb5cfbfa8e3cac4861dedf5dc8a843c65aefcdfb`
6. `006_staging_keyring_canary` — `486aa0d5ef3e17a176022fe4ece3256424ad2d464ba2861ddbfbaf72eb9359e5`
7. `007_owner_destination_binding` — `ea7faefff399a838715da61926129f0e753dfcfa699d2dc8e42c3a74e6f05f8e`
8. `008_destination_wallet_control` — `03a3f4b17fac191c12522405ebfcbecb4f029e91e777975e586e1524c3556208`

Migrations 007 and 008 are individually transactional and serialized by the existing advisory migration lock. Migration 007 safely retains legacy recipients as `legacy_destination_recipient`, assigns legacy rows binding version 1 with no owner, and requires all new version 2 rows to have an owner and no plaintext legacy recipient. It depends on the users table from 005. Migration 008 depends on 007 destination intents and adds immutable challenge/proof bindings, unique nonce/signature/digest constraints, restricted foreign keys, terminal state guards, and append-only audit events.

The disposable 001-006-to-008 rehearsal preserved a synthetic legacy row exactly and applied the complete ordered migration ledger. Fresh-image startup also applied 001-008 under the configured non-image runtime UID. A discovered image permission defect for untracked 0600 source files was fixed by normalizing only application files at build time; `node_modules` and runtime secrets are excluded from that chmod scope.

There are no automatic down migrations. Rollback is therefore restore-based: stop before financial activity, retain the pre-migration image and immutable image digest, take and authenticate an encrypted backup, rehearse its isolated restore, then restore the entire pre-migration database only under a separate approved incident procedure. Do not attempt column-level rollback of migration 007 after new owner-bound records exist.

## Disposable recovery evidence

- Built a local rehearsal image and applied migrations 001-008 in isolated compose project `zecathon-06d-rehearsal` with a dedicated disposable volume.
- Initialized and verified a test-only encrypted keyring canary.
- Created an authenticated, encrypted PostgreSQL backup with external and internal checksums.
- Restored it into an isolated PostgreSQL instance, verified exact migration sequence and encrypted inventory, restarted PostgreSQL, and confirmed byte-count inventory continuity.
- Rehearsed 001-006 legacy-data migration to 007/008 without rewriting or exposing the legacy recipient.
- The backup/restore drill intentionally contained no financial orders, so the 007/008 tables were empty. Non-empty encrypted destination/challenge/proof restart continuity is covered by disposable PostgreSQL integration tests, not by that archive drill.

## Browser and wallet evidence

- Headless Chrome with virtual WebAuthn: one synthetic account, two virtual passkeys, session rotation/revocation, cross-session login, private-history access, and blocked unverified destination — pass.
- Headless Chrome wallet/UI fixture: two synthetic authenticated owners, guest boundary, manual destination, chain mismatch, invalid recipient, cross-owner isolation, conflict rejection, withholding of receiver/instructions, responsive layout, and required disclosures — pass.
- Wallet permission/rejection/disconnect/network/account-switch behavior uses an injected EIP-1193 fixture. EOA signing/recovery uses real secp256k1 cryptography in Node, but not a real browser extension.
- Not yet demonstrated together in one browser journey: real WebAuthn plus a real external EOA signature. Not yet demonstrated: two real human browser accounts, a deployed Base Sepolia ERC-1271 wallet, or a hardware/account-abstraction wallet.

Unsupported or unverified wallet types remain: EIP-6492 counterfactual signatures, ERC-4337 wallets that do not expose ERC-1271 at the recipient address, multisig/vendor flows requiring non-standard payloads, EIP-7702/delegated-account edge cases, hardware wallets that reject the typed-data schema, wallets without `eth_signTypedData_v4`, and any wallet on a chain other than Base Sepolia 84532. These must remain labelled unverified and cannot receive payment instructions.

## UI and disclosure review

The reviewed UI explicitly states: testnet only; fixed test price; trusted testnet liquidity-provider custody; mainnet payments disabled; destination unverified until a separate user-initiated control signature succeeds; the signature is not a transaction or payout authorization; and shielding does not hide account, wallet-provider, RPC, or trusted-LP metadata. All 14 backend lifecycle states have explicit English, French, and Arabic labels. Human linguistic review of the French and Arabic copy remains pending.

## Verification commands and results

| Gate | Result |
| --- | --- |
| `POSTGRES_TEST_URL=... pnpm test` | 157 tests: 155 pass, 0 fail, 2 explicitly skipped live-chain tests |
| `pnpm typecheck` | Pass |
| `pnpm build` | Pass; 1,603 modules transformed |
| `pnpm test:browser` | Pass (`MILESTONE_06D_BROWSER_SMOKE_PASSED`) |
| `pnpm smoke:passkey -- http://localhost:18789` | Pass (`PASSKEY_BROWSER_SMOKE_PASSED`) |
| `pnpm privacy:scan` | Pass |
| `pnpm security:gate` | Pass |
| `pnpm staging:gate` | Pass; all 26 static checks |
| `pnpm preflight` | Expected block: dirty tree and intentionally absent domain/deployment secret paths |
| Disposable 001-008 migration/backup/restore/restart/legacy rehearsal | Pass |

The two skipped automated tests were the opt-in read-only live Base reference transaction and read-only live Zcash Experiment 03 checks. No live RPC credentials, wallet material, or transactions were used.

## Secret and repository-boundary review

- Scanned repository files outside `.git`, `node_modules`, and generated `dist` for PEM private-key headers and common cloud/API/token prefixes; no secret artifact was found.
- No generated `.pem`, `.key`, `.cookie`, `.db`, `.gpg`, `.seed`, or `.mnemonic` file exists in the repository.
- `.gitignore` protects environment variants (except `.env.example`), private/operator data, deployment secrets, backups, cookies, database files, and key/seed material.
- `.dockerignore` excludes environment files, private/operator data, deployment secrets, backups, build/cache data, and local audit helpers from the image context.
- Fixture wallet addresses and synthetic transaction-like values are public test data only. No private address, real wallet information, correlation record, credential, or cookie is proposed for commit.

## Staging image and deployment readiness

The untouched durable application container currently uses:

- tag: `zecathon-staging-durable-api:canary-repair-permissions-v2-20261025`
- image ID: `sha256:eaf1e685a55004fdcad1248f7af0b394c2b3ba5e0d253fbbf3408969a9b8f143`
- creation time: `2026-10-25T13:31:31.911463147+01:00`
- canary repair base image: `sha256:e84b002d05e935a8565d85108ddeb0ef5652a8ad58eed91b70271547aa8bb937`
- PostgreSQL image ID: `sha256:bb377b7239d2774ac8cc76f481596ce96c5a6b5e9d141f6d0a0ee371a6e7c0f2` (`postgres:17.7-alpine`)

The deployed image has no OCI source-revision label and contains migrations 001-006 only; their hashes match local exactly. Local application/store code differs because 007/008 and the owner-wallet work are not deployed. The disposable rehearsal image `sha256:07675b0290c819e52f5e1db778807bab30276c6e86eec14369512bb665ddcc08` was deleted and must not be deployed or treated as release provenance.

A staging candidate must be built from a reviewed committed SHA, carry source-revision metadata, be referenced by immutable digest, and record its Dockerfile/base-image/migration hashes. Before migration, require an authenticated encrypted backup of the current durable dataset, checksum verification, successful isolated restore/restart, retained prior image digest, and an approved recovery window.

Current durable WebAuthn configuration is loopback-only: `PUBLIC_ORIGIN=http://localhost:8787` and RP ID `localhost`. Any remote staging origin requires HTTPS, exact `PUBLIC_ORIGIN`, an RP ID equal to the host or registrable parent, `TRUST_PROXY=1`, and a fresh real-browser passkey ceremony for that origin. Base RPC must be an operator-approved HTTPS Base Sepolia endpoint; contract-wallet verification fails closed when it is unavailable.

Only an authenticated user may create an intent/challenge/signature. Only a separately authenticated operator may accept, allocate, activate, verify settlement, authorize payout, or recover an uncertain operation. Deployment/migration, backup custody, linked-test funding, Zcash wallet access, and any payout require separate explicit operator approvals. No application test grants those approvals.

## Scoped commits

1. `b82ba87 feat: harden durable staging recovery` — container/runtime permissions, compose isolation, keyring/backup/restore/preflight scripts, and associated tests/docs.
2. `ffff476 feat: add bounded route assistant` — provider boundary, deterministic tool registry, validation, tests, and operating documentation.
3. `6243b6d feat: verify owner-specific Base destinations` — migrations 007/008, API/store/settlement/UI integration, cryptographic verification, and tests/docs.
4. Integrated release audit — this Milestone 06D report, committed separately after final evidence review.

Every commit used an explicit path list and reviewed staged diff. No blanket add, history rewrite, or push was performed.

## First linked-test go/no-go checklist

Current decision: **NO-GO**.

- [x] Source diff and every untracked file reviewed and classified.
- [x] Full unit, disposable PostgreSQL, typecheck, build, browser, privacy, security, and static staging gates pass.
- [x] Migrations 001-008 and legacy data rehearsed on disposable PostgreSQL only.
- [x] Encrypted backup, isolated restore, PostgreSQL restart, and inventory continuity rehearsed.
- [x] Exact owner-specific recipient binding; no fixed operator receiver is accepted as a user payout destination.
- [x] Missing/expired/replayed/substituted/unavailable proofs fail closed.
- [ ] Review and commit the final diff; build an immutable candidate image from that commit with revision metadata.
- [ ] Take a fresh authenticated durable-staging backup and complete an isolated restore/restart under operator observation.
- [ ] Verify two real browser accounts using the exact approved staging RP ID/origin.
- [ ] Verify a real external EOA wallet in the same browser journey as WebAuthn; record rejection, disconnect, account-switch, and chain-switch evidence without storing the signature.
- [ ] Verify a deployed Base Sepolia ERC-1271 fixture, then change/revoke validity and confirm both acceptance and pre-payout checkpoints fail closed through the approved RPC.
- [ ] Obtain explicit deployment/migration, backup-custody, wallet-access, test-funding, allocation, acceptance, and payout approvals from the responsible operators.
- [ ] Repeat read-only Base and Zcash live integration checks against the approved endpoints; record block/transaction provenance without private correlation data.
- [ ] Human-review French/Arabic security and custody disclosures.

Only after every unchecked item has evidence linked to the candidate commit/image digest may the first linked staging test be reconsidered. Production readiness requires a separate review.
