import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('runtime command fails closed when Docker secret configuration is absent', () => {
  const result = spawnSync('sh', ['docker/runtime-command.sh', 'true'], {
    cwd: process.cwd(), encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DB_PASSWORD_FILE is required/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /postgresql:\/\//);
});

test('repair image overlays only reviewed canary runtime artifacts', async () => {
  const dockerfile = await readFile('docker/Dockerfile.canary-repair', 'utf8');
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s+/);
  assert.equal((dockerfile.match(/--chmod=0444/g) ?? []).length, 3);
  assert.equal((dockerfile.match(/--chmod=0555/g) ?? []).length, 1);
  const copied = [...dockerfile.matchAll(/^COPY[^\n]*\s(\S+)\s+\S+$/gm)].map(match => match[1]).sort();
  assert.deepEqual(copied, [
    'docker/runtime-command.sh',
    'scripts/staging-keyring-check.ts',
    'scripts/verify-backup-source.ts',
    'server/keyring-canary.ts',
  ]);
});

test('runtime image normalizes application files for the configured non-image UID without exposing secrets', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');
  assert.match(dockerfile, /find dist server src scripts -type f -exec chmod 0444/);
  assert.doesNotMatch(dockerfile, /find \/app|chmod -R|node_modules -type f/);
  assert.match(dockerfile, /chmod 0555 \/usr\/local\/bin\/zecathon-entrypoint \/usr\/local\/bin\/zecathon-runtime-command/);
});
