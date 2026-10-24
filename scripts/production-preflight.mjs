#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const staticOnly = process.argv.includes('--static');
const checks = [];
function check(name, ok, detail) { checks.push({ name, ok, detail }); }
function run(command, args, env = process.env) { return spawnSync(command, args, { encoding: 'utf8', env }); }

const branch = run('git', ['branch', '--show-current']);
check('git-main', branch.status === 0 && branch.stdout.trim() === 'main', branch.stdout.trim() || branch.stderr.trim());
const status = run('git', ['status', '--porcelain']);
check('git-clean', status.status === 0 && status.stdout.trim() === '', status.stdout.trim() ? 'working tree has changes' : 'clean');

const [compose, dockerignore, publicApi, verifier, keyring] = await Promise.all([
  readFile('compose.yaml', 'utf8'), readFile('.dockerignore', 'utf8'), readFile('server/public-api.ts', 'utf8'),
  readFile('server/zcash-verifier.ts', 'utf8'), readFile('server/data-encryption.ts', 'utf8'),
]);
check('no-wallet-volume', !/(zecd|wallet-[ab]|wallet_a|wallet_b).*(?:volume|\/run\/secrets)/i.test(compose), 'Compose has no zecd or wallet mount');
check('private-artifacts-excluded', ['deploy/secrets', 'operator-data', 'private', '.env'].every(value => dockerignore.split(/\r?\n/).includes(value) || dockerignore.includes(`${value}\n`)), 'Private paths are excluded from the image context');
check('no-public-operator-mutations', !/(approve-payout|derive-address|broadcast|wallet-rpc)/.test(publicApi), 'Public API contains no operator mutation route');
check('watch-only-custody-gate', verifier.includes('private_keys_enabled === false') && verifier.includes('unlocked_until === 0'), 'Verifier accepts watch-only or explicitly locked custody only');
check('aes-256-gcm-keyring', keyring.includes("createCipheriv('aes-256-gcm'") && keyring.includes('activeVersion'), 'Versioned AES-256-GCM keyring is enforced');

const composeCheck = run('docker', ['compose', 'config', '--quiet'], { ...process.env, DOMAIN: process.env.DOMAIN || 'preflight.invalid', ROUTE_DESTINATION_RECIPIENT: process.env.ROUTE_DESTINATION_RECIPIENT || `0x${'1'.repeat(40)}` });
check('compose-config', composeCheck.status === 0, composeCheck.status === 0 ? 'valid' : (composeCheck.stderr.trim() || 'docker compose unavailable'));

async function secret(name, path, validator) {
  if (!path) { check(name, false, 'path is not configured'); return; }
  try {
    const absolute = resolve(path); const metadata = await stat(absolute); const value = await readFile(absolute, 'utf8');
    check(name, metadata.isFile() && (metadata.mode & 0o077) === 0 && validator(value), 'regular private file with valid schema');
  } catch { check(name, false, 'file is unavailable or invalid'); }
}

if (!staticOnly) {
  let domainValid = false; try { const value = new URL(`https://${process.env.DOMAIN ?? ''}`); domainValid = value.hostname === process.env.DOMAIN && value.protocol === 'https:'; } catch {}
  check('domain', domainValid, domainValid ? 'valid hostname' : 'DOMAIN is missing or invalid');
  check('destination-recipient', /^0x[0-9a-f]{40}$/i.test(process.env.ROUTE_DESTINATION_RECIPIENT ?? '') && !/^0x0{40}$/i.test(process.env.ROUTE_DESTINATION_RECIPIENT ?? ''), 'complete non-zero Base address');
  await secret('database-password', process.env.DB_PASSWORD_FILE, value => value.trim().length >= 32 && !value.trim().includes('\n'));
  await secret('verifier-service-token', process.env.VERIFIER_TOKEN_FILE, value => value.trim().length >= 32 && !value.trim().includes('\n'));
  await secret('encryption-keyring', process.env.ZECATHON_ENCRYPTION_KEY_FILE, value => { try { const parsed = JSON.parse(value); return Number.isSafeInteger(parsed.activeVersion) && Object.values(parsed.keys ?? {}).every(item => typeof item === 'string' && Buffer.from(item, 'base64').length === 32); } catch { return false; } });
  await secret('relay-encryption-keyring', process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE, value => { try { const parsed = JSON.parse(value); return Number.isSafeInteger(parsed.activeVersion) && Object.values(parsed.keys ?? {}).every(item => typeof item === 'string' && Buffer.from(item, 'base64').length === 32); } catch { return false; } });
  check('separate-encryption-keyrings', Boolean(process.env.ZECATHON_ENCRYPTION_KEY_FILE && process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE && resolve(process.env.ZECATHON_ENCRYPTION_KEY_FILE) !== resolve(process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE)), 'Order and relay keyring paths must differ');
  await secret('relay-coordinator-private-key', process.env.ZECATHON_RELAY_COORDINATOR_PRIVATE_KEY_FILE, value => /BEGIN PRIVATE KEY/.test(value));
  await secret('relay-verifier-public-key', process.env.ZECATHON_RELAY_VERIFIER_PUBLIC_KEY_FILE, value => /BEGIN PUBLIC KEY/.test(value));
  if (process.env.BACKUP_DIRECTORY) {
    try { const metadata = await stat(resolve(process.env.BACKUP_DIRECTORY)); check('backup-directory', metadata.isDirectory() && (metadata.mode & 0o077) === 0, 'private backup target exists'); }
    catch { check('backup-directory', false, 'backup target is unavailable'); }
  } else check('backup-directory', false, 'BACKUP_DIRECTORY is not configured');
}

const failed = checks.filter(item => !item.ok);
process.stdout.write(`${JSON.stringify({ status: failed.length === 0 ? 'PRODUCTION_LAUNCH_PREFLIGHT_READY' : 'PRODUCTION_LAUNCH_PREFLIGHT_BLOCKED', mode: staticOnly ? 'static' : 'full', checks, failed: failed.map(item => item.name) }, null, 2)}\n`);
if (failed.length) process.exitCode = 2;
