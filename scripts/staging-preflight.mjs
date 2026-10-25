#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const [compose, auth, migration, destinationMigration, walletControlMigration, walletControl, settlement, entrypoint, provisioner, backup, restore, durableCheck] = await Promise.all([
  readFile('compose.staging.yaml', 'utf8'), readFile('server/user-auth.ts', 'utf8'),
  readFile('server/migrations/005_passkey_identity.sql', 'utf8'), readFile('server/migrations/007_owner_destination_binding.sql', 'utf8'), readFile('server/migrations/008_destination_wallet_control.sql', 'utf8'), readFile('server/wallet-control.ts', 'utf8'), readFile('server/postgres-settlement-store.ts', 'utf8'), readFile('docker/entrypoint.sh', 'utf8'),
  readFile('scripts/provision-staging-secrets.sh', 'utf8'), readFile('scripts/staging-backup.sh', 'utf8'),
  readFile('scripts/staging-restore-drill.sh', 'utf8'), readFile('scripts/staging-durable-check.sh', 'utf8'),
]);
const checks = [];
const check = (name, ok) => checks.push({ name, ok });
check('postgres-17', /image: postgres:17\.7-alpine/.test(compose));
check('database-has-no-host-port', !/postgres:[\s\S]*?ports:/m.test(compose.split('\n  migrate:')[0]));
check('api-loopback-only', compose.includes('127.0.0.1:8787:8787'));
check('dedicated-named-volume', compose.includes('STAGING_POSTGRES_VOLUME:-zecathon_staging_postgres_data'));
check('isolatable-compose-project', compose.includes('STAGING_COMPOSE_PROJECT:-zecathon-staging'));
check('external-secret-directory-required', compose.includes('STAGING_SECRETS_DIR:?'));
check('same-staging-database', (compose.match(/DB_NAME: zecathon_staging_live/g) ?? []).length === 1 && compose.includes('&database_environment') && compose.includes('<<: *database_environment'));
check('explicit-localhost-rp', compose.includes('WEBAUTHN_RP_ID: localhost') && compose.includes('PUBLIC_ORIGIN: http://localhost:8787'));
check('origin-and-rp-verified', auth.includes('expectedOrigin: this.config.expectedOrigin') && auth.includes('expectedRPID: this.config.rpId'));
check('user-verification-required', (auth.match(/requireUserVerification: true/g) ?? []).length >= 2);
check('one-time-expiring-challenge', auth.includes('consumed_at IS NULL AND expires_at > now()'));
check('credential-counter-atomic', auth.includes('AND counter=$5 AND revoked_at IS NULL'));
check('database-sessions-and-revocation', migration.includes('CREATE TABLE IF NOT EXISTS user_sessions') && auth.includes("SESSION_REVOKED"));
check('multiple-passkeys', migration.includes('passkey_credentials_user_active') && !migration.includes('UNIQUE (user_id)'));
check('runtime-drops-root', entrypoint.includes('setpriv --reuid=10001'));
check('local-interactive-provisioning', provisioner.includes('[ -t 0 ] && [ -t 1 ]') && provisioner.includes('CONFIRM BASE-SEPOLIA 84532'));
check('encrypted-owner-destination-binding', destinationMigration.includes('encrypted_intent bytea NOT NULL') && destinationMigration.includes('owner_user_id uuid NOT NULL') && destinationMigration.includes("wallet_control_verification = 'NOT_PERFORMED'") && settlement.includes('destinationIntentContext') && !compose.includes('ROUTE_DESTINATION_RECIPIENT') && !provisioner.includes('ROUTE_DESTINATION_RECIPIENT') && !durableCheck.includes('ROUTE_DESTINATION_RECIPIENT'));
check('cryptographic-destination-control', walletControlMigration.includes('destination_wallet_challenges') && walletControlMigration.includes('destination_wallet_proofs') && walletControlMigration.includes('signature_fingerprint') && walletControl.includes('recoverTypedDataAddress') && walletControl.includes('isValidSignature') && settlement.includes('valid required wallet-control proof'));
check('isolated-durable-dataset', provisioner.includes('zecathon-staging-durable') && provisioner.includes('zecathon_staging_durable_postgres_data') && durableCheck.includes('Legacy temporary PostgreSQL volume cannot be reused'));
check('versioned-independent-keyrings', provisioner.includes('encryption-keyring.json') && provisioner.includes('relay-encryption-keyring.json') && provisioner.includes('"activeVersion":1'));
check('dedicated-backup-credential', provisioner.includes('backup-passphrase') && backup.includes('BACKUP_PASSPHRASE_FILE') && !backup.includes("gpg --symmetric --cipher-algo AES256 --output"));
check('backup-and-archive-checksums', backup.includes('SHA256SUMS') && backup.includes('$output.sha256') && restore.includes('sha256sum -c'));
check('backup-source-canary-preflight', backup.includes('zecathon-runtime-command') && backup.includes('verify-backup-source.ts') && !backup.includes('staging-keyring-check.ts'));
check('backup-restore-covers-migrations-001-008', backup.includes('migrations.txt') && restore.includes('verify-restored-db.ts') && (await readFile('scripts/verify-backup-source.ts','utf8')).includes('008_destination_wallet_control') && (await readFile('scripts/verify-restored-db.ts','utf8')).includes('walletProofs'));
check('restore-restart-inventory', restore.includes('docker restart "$container"') && restore.includes('before_restart') && restore.includes('after_restart') && restore.includes('compare-recovery-inventory.ts'));
const config = spawnSync('docker', ['compose', '-f', 'compose.staging.yaml', 'config', '--quiet'], { encoding: 'utf8', env: {
  ...process.env, STAGING_SECRETS_DIR: '/tmp/zecathon-preflight-secrets',
  STAGING_COMPOSE_PROJECT: 'zecathon-preflight', STAGING_POSTGRES_VOLUME: 'zecathon_preflight_postgres_data',
  ZECATHON_OPERATOR_ID: 'preflight-operator', STAGING_RUNTIME_UID: '1000', STAGING_RUNTIME_GID: '1000',
} });
check('compose-config', config.status === 0);
const failed = checks.filter(item => !item.ok);
process.stdout.write(`${JSON.stringify({ status: failed.length ? 'DURABLE_STAGING_BLOCKED' : 'DURABLE_STAGING_STATIC_READY', checks, failed: failed.map(item => item.name) }, null, 2)}\n`);
if (failed.length) process.exitCode = 2;
