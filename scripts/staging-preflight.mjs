#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const [compose, auth, migration, entrypoint] = await Promise.all([
  readFile('compose.staging.yaml', 'utf8'), readFile('server/user-auth.ts', 'utf8'),
  readFile('server/migrations/005_passkey_identity.sql', 'utf8'), readFile('docker/entrypoint.sh', 'utf8'),
]);
const checks = [];
const check = (name, ok) => checks.push({ name, ok });
check('postgres-17', /image: postgres:17\.7-alpine/.test(compose));
check('database-has-no-host-port', !/postgres:[\s\S]*?ports:/m.test(compose.split('\n  migrate:')[0]));
check('api-loopback-only', compose.includes('127.0.0.1:8787:8787'));
check('dedicated-named-volume', compose.includes('name: zecathon_staging_postgres_data'));
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
const config = spawnSync('docker', ['compose', '-f', 'compose.staging.yaml', 'config', '--quiet'], { encoding: 'utf8', env: {
  ...process.env, STAGING_SECRETS_DIR: '/tmp/zecathon-preflight-secrets', ROUTE_DESTINATION_RECIPIENT: `0x${'1'.repeat(40)}`,
  ZECATHON_OPERATOR_ID: 'preflight-operator', STAGING_RUNTIME_UID: '1000', STAGING_RUNTIME_GID: '1000',
} });
check('compose-config', config.status === 0);
const failed = checks.filter(item => !item.ok);
process.stdout.write(`${JSON.stringify({ status: failed.length ? 'DURABLE_STAGING_BLOCKED' : 'DURABLE_STAGING_STATIC_READY', checks, failed: failed.map(item => item.name) }, null, 2)}\n`);
if (failed.length) process.exitCode = 2;
